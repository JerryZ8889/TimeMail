import { DateTime } from "luxon";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import { toIso } from "../lib/time";
import { fetchGoogleNewsRss } from "./googleNewsRss";
import { fetchGdeltDocs } from "./gdelt";
import { translateItemsToZh } from "./translate";
import type { NewNewsItem, Topic } from "../lib/types";

function topicQueries(topic: Topic): string[] {
  if (topic === "CATL")
    return [
      "宁德时代 OR CATL OR Contemporary Amperex",
      "CATL battery OR CATL energy storage",
      "宁德时代 动力电池 OR 储能",
    ];
  return ["小米 OR 小米集团 OR Xiaomi", "小米 汽车 OR SU7 OR Xiaomi EV", "Xiaomi smartphone OR Xiaomi Auto"];
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

export async function runManualSync(params: { lookbackHours?: number } = {}): Promise<{
  status: "SUCCESS" | "FAILED";
  windowStart: string;
  windowEnd: string;
  fetchedCount: number;
  dedupedCount: number;
  outputCount: number;
  errorMessage?: string | null;
}> {
  const supabase = createSupabaseAdmin();
  const now = DateTime.now();
  const windowEnd = toIso(now);
  const lookback = Number.isFinite(params.lookbackHours) ? Math.max(1, Math.min(240, params.lookbackHours ?? 168)) : 168;
  const windowStart = toIso(now.minus({ hours: lookback }));

  try {
    const sourceResults = await Promise.allSettled([
      fetchGoogleNewsRss("CATL", topicQueries("CATL")),
      fetchGoogleNewsRss("XIAOMI", topicQueries("XIAOMI")),
      fetchGdeltDocs({
        topic: "CATL",
        query: gdeltQuery("CATL"),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 120,
      }),
      fetchGdeltDocs({
        topic: "XIAOMI",
        query: gdeltQuery("XIAOMI"),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 120,
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
        const translated = await translateItemsToZh(translateIdx.map(({ it }) => ({ title: it.title, summary: it.summary })));
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

    return { status: "SUCCESS", windowStart, windowEnd, fetchedCount, dedupedCount, outputCount, errorMessage: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "同步失败";
    return { status: "FAILED", windowStart, windowEnd, fetchedCount: 0, dedupedCount: 0, outputCount: 0, errorMessage: msg };
  }
}
