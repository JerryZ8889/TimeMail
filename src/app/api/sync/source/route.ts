import { DateTime } from "luxon";
import { getOptionalEnv } from "../../../../lib/env";
import { createSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { SOURCE_LIST } from "../../../../config/sources";
import {
  fetchGoogleNewsRssWithLocales,
  GOOGLE_NEWS_ZH_CN,
  GOOGLE_NEWS_EN_US,
} from "../../../../server/googleNewsRss";
import { fetchGdeltDocs } from "../../../../server/gdelt";
import type { NewNewsItem } from "../../../../lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  secret?: string;
  sourceIndex?: number;
  windowStart?: string;
  windowEnd?: string;
};

function verify(req: Request, body: Body): boolean {
  const expected = getOptionalEnv("CRON_SECRET");
  if (!expected) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  return (body.secret ?? "") === expected;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!verify(req, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sourceIndex = typeof body.sourceIndex === "number" ? body.sourceIndex : -1;
  const source = SOURCE_LIST[sourceIndex];
  if (!source) {
    return Response.json({ ok: false, errorMessage: `无效的源索引: ${sourceIndex}` }, { status: 400 });
  }

  const windowStart = body.windowStart ?? "";
  const windowEnd = body.windowEnd ?? "";
  if (!windowStart || !windowEnd) {
    return Response.json({ ok: false, errorMessage: "缺少 windowStart/windowEnd" }, { status: 400 });
  }

  try {
    let items: Array<{
      topic: string;
      title: string;
      summary: string | null;
      url: string;
      source: string;
      publishedAt: Date;
      contentHash: string;
      language: string;
    }> = [];

    if (source.type === "rss") {
      const locale = source.locale === "en-US" ? GOOGLE_NEWS_EN_US : GOOGLE_NEWS_ZH_CN;
      items = await fetchGoogleNewsRssWithLocales(source.topic, [source.query], [locale]);
    } else {
      items = await fetchGdeltDocs({
        topic: source.topic,
        query: source.query,
        windowStartIso: windowStart,
        windowEndIso: windowEnd,
        maxRecords: source.maxRecords ?? 200,
      });
    }

    const windowStartMs = DateTime.fromISO(windowStart, { zone: "utc" }).toMillis();
    const windowEndMs = DateTime.fromISO(windowEnd, { zone: "utc" }).toMillis();

    const filtered = items.filter((it) => {
      const t = it.publishedAt.getTime();
      return t > windowStartMs && t <= windowEndMs;
    });

    const rows: NewNewsItem[] = filtered.map((it) => ({
      topic: source.topic,
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

    let upsertCount = 0;
    if (rows.length) {
      const supabase = createSupabaseAdmin();
      const { error: upsertErr } = await supabase.from("news_item").upsert(rows, { onConflict: "content_hash" });
      if (upsertErr) throw upsertErr;
      upsertCount = rows.length;
    }

    return Response.json({
      ok: true,
      sourceName: source.label,
      count: upsertCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "抓取失败";
    return Response.json({
      ok: false,
      sourceName: source.label,
      count: 0,
      errorMessage: msg,
    });
  }
}
