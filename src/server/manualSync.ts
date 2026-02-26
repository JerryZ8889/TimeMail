import { DateTime } from "luxon";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import { toIso } from "../lib/time";
import { fetchGoogleNewsRss } from "./googleNewsRss";
import { fetchGdeltDocs } from "./gdelt";
import type { NewNewsItem } from "../lib/types";
import { TOPIC_KEYS, getTopicQueries, getGdeltQuery } from "../config/topics";

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
    const rssPromises = TOPIC_KEYS.map((t) => fetchGoogleNewsRss(t, getTopicQueries(t)));
    const gdeltPromises = TOPIC_KEYS.map((t) =>
      fetchGdeltDocs({
        topic: t,
        query: getGdeltQuery(t),
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: 120,
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

    const outputCount = unique.length;
    const dedupedCount = filtered.length - unique.length;

    const rows: NewNewsItem[] = unique.map((it) => ({
      topic: it.topic,
      title: it.title,
      title_zh: null,
      url: it.url,
      source: it.source,
      published_at: new Date(it.publishedAt).toISOString(),
      content_hash: it.contentHash,
      language: it.language ?? "und",
      summary: it.summary ?? null,
      summary_zh: null,
    }));

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
