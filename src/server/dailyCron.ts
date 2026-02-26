import { DateTime } from "luxon";
import { getOptionalEnv } from "../lib/env";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import type { NewNewsItem, Topic } from "../lib/types";
import { computeWindowEndShanghai, toIso } from "../lib/time";
import { fetchGoogleNewsRss } from "./googleNewsRss";
import { fetchGdeltDocs } from "./gdelt";
import { buildEmailHtml, sendReportEmail } from "./email";
import { translateItemsToZh } from "./translate";

function parseIsoOrNull(v: string | null | undefined): DateTime | null {
  if (!v) return null;
  const dt = DateTime.fromISO(v, { zone: "utc" });
  return dt.isValid ? dt : null;
}

function topicQueries(topic: Topic): string[] {
  if (topic === "CATL") return [
    "宁德时代 OR CATL OR Contemporary Amperex",
    "CATL battery OR CATL energy storage",
    "宁德时代 动力电池 OR 储能",
  ];
  return [
    "小米 OR 小米集团 OR Xiaomi",
    "小米 汽车 OR SU7 OR Xiaomi EV",
    "Xiaomi smartphone OR Xiaomi Auto",
  ];
}

function gdeltQuery(topic: Topic): string {
  if (topic === "CATL") return '(CATL OR "Contemporary Amperex" OR 宁德时代)';
  return '(Xiaomi OR 小米 OR "Xiaomi Auto" OR SU7)';
}

function groupByTopic<T extends { topic: Topic }>(items: T[]): Record<Topic, T[]> {
  return items.reduce(
    (acc, it) => {
      acc[it.topic].push(it);
      return acc;
    },
    { CATL: [], XIAOMI: [] } as Record<Topic, T[]>,
  );
}

export async function runDailyCron(): Promise<{
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  windowStart: string;
  windowEnd: string;
  fetchedCount: number;
  dedupedCount: number;
  outputCount: number;
  errorMessage?: string | null;
}> {
  const supabase = createSupabaseAdmin();
  const toEmail = getOptionalEnv("REPORT_TO_EMAIL") ?? "1619900613@qq.com";
  const now = DateTime.now();
  const windowEndDt = computeWindowEndShanghai(now);
  const windowEnd = toIso(windowEndDt);

  const { data: running } = await supabase
    .from("run_log")
    .select("id,started_at,status")
    .eq("status", "RUNNING")
    .order("started_at", { ascending: false })
    .limit(1);

  if (running?.[0]) {
    const started = DateTime.fromISO(running[0].started_at);
    if (started.isValid && now.diff(started, "minutes").minutes < 45) {
      return {
        status: "SKIPPED",
        windowStart: windowEnd,
        windowEnd,
        fetchedCount: 0,
        dedupedCount: 0,
        outputCount: 0,
        errorMessage: null,
      };
    }
  }

  const { data: jobStateRow, error: jobErr } = await supabase
    .from("job_state")
    .select("key,last_success_at")
    .eq("key", "daily_news")
    .maybeSingle();

  if (jobErr) throw jobErr;

  const lastSuccess = parseIsoOrNull(jobStateRow?.last_success_at ?? null);
  const windowStartDt = lastSuccess ?? windowEndDt.minus({ days: 1 });
  const windowStart = toIso(windowStartDt);

  const { data: runRow, error: runInsertErr } = await supabase
    .from("run_log")
    .insert({
      status: "RUNNING",
      window_start: windowStart,
      window_end: windowEnd,
      email_to: toEmail,
      fetched_count: 0,
      deduped_count: 0,
      output_count: 0,
    })
    .select("id")
    .single();

  if (runInsertErr) throw runInsertErr;
  const runId = runRow.id;

  const dryRun = getOptionalEnv("DRY_RUN") === "1";
  const skipEmail = getOptionalEnv("SKIP_EMAIL") === "1";

  try {
    const sourceResults = await Promise.allSettled([
      fetchGoogleNewsRss("CATL", topicQueries("CATL")),
      fetchGoogleNewsRss("XIAOMI", topicQueries("XIAOMI")),
      fetchGdeltDocs({
        topic: "CATL",
        query: gdeltQuery("CATL"),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 80,
      }),
      fetchGdeltDocs({
        topic: "XIAOMI",
        query: gdeltQuery("XIAOMI"),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 80,
      }),
    ]);

    const catlGoogle = sourceResults[0].status === "fulfilled" ? sourceResults[0].value : [];
    const xiaomiGoogle = sourceResults[1].status === "fulfilled" ? sourceResults[1].value : [];
    const catlGdelt = sourceResults[2].status === "fulfilled" ? sourceResults[2].value : [];
    const xiaomiGdelt = sourceResults[3].status === "fulfilled" ? sourceResults[3].value : [];

    const all = [...catlGoogle, ...xiaomiGoogle, ...catlGdelt, ...xiaomiGdelt];
    const fetchedCount = all.length;
    const windowStartMs = DateTime.fromISO(windowStart, { zone: "utc" }).toMillis();
    const windowEndMs = DateTime.fromISO(windowEnd, { zone: "utc" }).toMillis();

    const filtered = all.filter((it) => {
      const t = it.publishedAt.getTime();
      return t > windowStartMs && t <= windowEndMs;
    });

    const seen = new Set<string>();
    const unique = [] as typeof filtered;
    for (const it of filtered) {
      if (seen.has(it.contentHash)) continue;
      seen.add(it.contentHash);
      unique.push(it);
    }

    unique.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    const translateIdx = unique
      .map((it, idx) => ({ idx, it }))
      .filter(({ it }) => {
        const lang = (it.language ?? "").toLowerCase();
        return lang !== "zh" && lang !== "zh-cn" && lang !== "zh-hans";
      });

    const translatedTitles = new Map<number, { title_zh: string | null; summary_zh: string | null }>();
    if (translateIdx.length) {
      try {
        const translated = await translateItemsToZh(
          translateIdx.map(({ it }) => ({ title: it.title, summary: it.summary })),
        );
        translated.forEach((tr, i) => {
          const idx = translateIdx[i]?.idx;
          if (typeof idx === "number") {
            translatedTitles.set(idx, { title_zh: tr.titleZh, summary_zh: tr.summaryZh });
          }
        });
      } catch {
        // best-effort translation
      }
    }

    const outputCount = unique.length;
    const dedupedCount = filtered.length - unique.length;

    const rows: NewNewsItem[] = unique.map((it, idx) => {
      const tr = translatedTitles.get(idx);
      return {
        topic: it.topic,
        title: it.title,
        title_zh: tr?.title_zh ?? null,
        url: it.url,
        source: it.source,
        published_at: new Date(it.publishedAt).toISOString(),
        content_hash: it.contentHash,
        language: it.language ?? "und",
        summary: it.summary ?? null,
        summary_zh: tr?.summary_zh ?? null,
      };
    });

    if (!dryRun && rows.length) {
      const { error: upsertErr } = await supabase.from("news_item").upsert(rows, { onConflict: "content_hash" });
      if (upsertErr) throw upsertErr;
    }

    const itemsByTopic = groupByTopic(
      unique.map((it, idx) => {
        const tr = translatedTitles.get(idx);
        return {
          ...it,
          title_zh: tr?.title_zh ?? null,
          summary_zh: tr?.summary_zh ?? null,
        };
      }),
    );
    const subjectDate = windowEndDt.setZone("Asia/Shanghai").toFormat("yyyy-LL-dd");
    const subject = `资讯日报（宁德时代/小米）${subjectDate} 08:00`;
    const html = buildEmailHtml({
      windowStartIso: windowStart,
      windowEndIso: windowEnd,
      itemsByTopic,
      fetchedCount: filtered.length,
      dedupedCount,
      outputCount,
    });

    if (!dryRun && !skipEmail) {
      await sendReportEmail({ subject, html });
    }

    await supabase
      .from("run_log")
      .update({
        ended_at: now.toUTC().toISO(),
        status: "SUCCESS",
        window_start: windowStart,
        window_end: windowEnd,
        fetched_count: filtered.length,
        deduped_count: dedupedCount,
        output_count: outputCount,
        email_to: toEmail,
        error_message: null,
      })
      .eq("id", runId);

    if (!dryRun) {
      await supabase
        .from("job_state")
        .update({ last_success_at: windowEnd, updated_at: now.toUTC().toISO() })
        .eq("key", "daily_news");
    }

    return { status: "SUCCESS", windowStart, windowEnd, fetchedCount, dedupedCount, outputCount, errorMessage: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabase
      .from("run_log")
      .update({
        ended_at: now.toUTC().toISO(),
        status: "FAILED",
        window_start: windowStart,
        window_end: windowEnd,
        email_to: toEmail,
        error_message: msg,
      })
      .eq("id", runId);

    return {
      status: "FAILED",
      windowStart,
      windowEnd,
      fetchedCount: 0,
      dedupedCount: 0,
      outputCount: 0,
      errorMessage: msg,
    };
  }
}
