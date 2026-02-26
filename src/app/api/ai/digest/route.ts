import { getOptionalEnv } from "../../../../lib/env";
import { createSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import type { NewsItemRow } from "../../../../lib/types";
import { buildAiDigest } from "../../../../server/aiDigest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeInt(v: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeQuery(q: string): string {
  return q.replaceAll("%", " ").replaceAll("_", " ").trim().slice(0, 80);
}

export async function GET(req: Request) {
  const envReady = Boolean(getOptionalEnv("SUPABASE_URL") && getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
  if (!envReady) {
    return Response.json({ ok: false, message: "Supabase 环境变量未配置完成" }, { status: 500 });
  }

  const url = new URL(req.url);
  const topicRaw = (url.searchParams.get("topic") ?? "CATL").toUpperCase();
  const topic = (topicRaw === "CATL" || topicRaw === "XIAOMI" ? topicRaw : "CATL") as "CATL" | "XIAOMI";
  const daysRaw = (url.searchParams.get("days") ?? "ALL").toUpperCase();
  const days = (daysRaw === "1" || daysRaw === "7" || daysRaw === "30" ? daysRaw : "ALL") as "1" | "7" | "30" | "ALL";
  const q = sanitizeQuery(url.searchParams.get("q") ?? "");
  const pageSize = safeInt(url.searchParams.get("pageSize") ?? "50", 50, 10, 200);
  const page = safeInt(url.searchParams.get("page") ?? "1", 1, 1, 1000000);

  const supabase = createSupabaseAdmin();
  let query = supabase.from("news_item").select("*").order("published_at", { ascending: false });

  query = query.eq("topic", topic);

  if (days !== "ALL") {
    const n = Number.parseInt(days, 10);
    const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("published_at", since);
  }

  if (q) {
    const like = `%${q}%`;
    query = query.or(
      [
        `title.ilike.${like}`,
        `title_zh.ilike.${like}`,
        `summary.ilike.${like}`,
        `summary_zh.ilike.${like}`,
        `source.ilike.${like}`,
      ].join(","),
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data } = await query.range(from, to);
  const items = (data ?? []) as NewsItemRow[];
  if (!items.length) {
    return Response.json({ ok: false, message: "当前筛选结果为空" }, { status: 400 });
  }

  try {
    const digest = await buildAiDigest({ items, topic, q, days });
    if (!digest) {
      return Response.json({ ok: false, message: "AI 解读未启用或未配置 Key" }, { status: 400 });
    }
    return Response.json({ ok: true, digest });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 解读失败";
    if (msg.includes("HTTP 429")) {
      return Response.json({ ok: false, message: "Zhipu 限流（HTTP 429），稍后再试" }, { status: 429 });
    }
    return Response.json({ ok: false, message: msg }, { status: 500 });
  }
}
