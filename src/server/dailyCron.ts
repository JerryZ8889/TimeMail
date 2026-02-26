import { DateTime } from "luxon";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import type { NewNewsItem } from "../lib/types";
import { computeWindowEndShanghai, toIso } from "../lib/time";
import { fetchGoogleNewsRss } from "./googleNewsRss";
import { fetchGdeltDocs } from "./gdelt";
import { translateItemsToZh } from "./translate";
import { TOPIC_KEYS, getTopicQueries, getGdeltQuery } from "../config/topics";

function parseIsoOrNull(v: string | null | undefined): DateTime | null {
  if (!v) return null;
  const dt = DateTime.fromISO(v, { zone: "utc" });
  return dt.isValid ? dt : null;
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
      fetched_count: 0,
      deduped_count: 0,
      output_count: 0,
    })
    .select("id")
    .single();

  if (runInsertErr) throw runInsertErr;
  const runId = runRow.id;

  try {
    const rssPromises = TOPIC_KEYS.map((t) => fetchGoogleNewsRss(t, getTopicQueries(t)));
    const gdeltPromises = TOPIC_KEYS.map((t) =>
      fetchGdeltDocs({
        topic: t,
        query: getGdeltQuery(t),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 80,
      }),
    );
    const sourceResults = await Promise.allSettled([...rssPromises, ...gdeltPromises]);

    const all = sourceResults
      .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

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

    if (rows.length) {
      const { error: upsertErr } = await supabase.from("news_item").upsert(rows, { onConflict: "content_hash" });
      if (upsertErr) throw upsertErr;
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
        error_message: null,
      })
      .eq("id", runId);

    await supabase
      .from("job_state")
      .update({ last_success_at: windowEnd, updated_at: now.toUTC().toISO() })
      .eq("key", "daily_news");

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
