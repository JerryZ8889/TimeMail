import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getOptionalEnv } from "../../lib/env";
import { createSupabaseAdmin } from "../../lib/supabaseAdmin";
import type { NewsItemRow } from "../../lib/types";
import { AiDigestPanel } from "./AiDigestPanel";
import { TOPIC_KEYS, DEFAULT_TOPIC, topicDisplayName, isValidTopic, allTopicDisplayNames } from "../../config/topics";

type SearchParams = Record<string, string | string[] | undefined>;

function fmt(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function pickFirst(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function safeInt(v: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeQuery(q: string): string {
  return q.replaceAll("%", " ").replaceAll("_", " ").trim().slice(0, 80);
}

function buildHref(base: string, params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    const s = String(v);
    if (!s) return;
    sp.set(k, s);
  });
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

async function loadNews(params: SearchParams): Promise<{
  envReady: boolean;
  items: NewsItemRow[];
  count: number | null;
  filters: {
    topic: "CATL" | "XIAOMI";
    q: string;
    days: "1" | "7" | "30" | "ALL";
    page: number;
    pageSize: number;
  };
}> {
  const envReady = Boolean(getOptionalEnv("SUPABASE_URL") && getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const topicRaw = pickFirst(params.topic).toUpperCase();
  const topic = isValidTopic(topicRaw) ? topicRaw : DEFAULT_TOPIC;
  const q = sanitizeQuery(pickFirst(params.q));
  const daysRaw = pickFirst(params.days).toUpperCase();
  const days = (daysRaw === "1" || daysRaw === "7" || daysRaw === "30" ? daysRaw : "ALL") as "1" | "7" | "30" | "ALL";
  const pageSize = safeInt(pickFirst(params.pageSize), 50, 10, 200);
  const page = safeInt(pickFirst(params.page), 1, 1, 1000000);

  if (!envReady) {
    return {
      envReady: false,
      items: [],
      count: null,
      filters: { topic, q, days, page, pageSize },
    };
  }

  const supabase = createSupabaseAdmin();

  let query = supabase.from("news_item").select("*", { count: "estimated" }).order("published_at", { ascending: false });
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
  const { data, count } = await query.range(from, to);

  return {
    envReady: true,
    items: (data ?? []) as NewsItemRow[],
    count: typeof count === "number" ? count : null,
    filters: { topic, q, days, page, pageSize },
  };
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const data = await loadNews(params);
  const f = data.filters;

  const prevHref =
    f.page > 1
      ? buildHref("/news", { topic: f.topic, q: f.q, days: f.days, pageSize: f.pageSize, page: f.page - 1 })
      : null;
  const nextHref =
    data.items.length === f.pageSize
      ? buildHref("/news", { topic: f.topic, q: f.q, days: f.days, pageSize: f.pageSize, page: f.page + 1 })
      : null;
  const statusHref = buildHref("/status", {
    topic: f.topic,
    q: f.q,
    days: f.days,
    pageSize: f.pageSize,
    page: f.page,
  });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold">
              日
            </div>
            <div>
              <div className="text-sm font-semibold leading-5">资讯日报机器人</div>
              <div className="text-xs text-zinc-500">{allTopicDisplayNames()}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <Link
              href={statusHref}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              状态页
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        {!data.envReady ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            环境变量未配置完成：请在本地 `.env.local` 或 Vercel 项目环境变量中设置 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。
          </div>
        ) : null}

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold">资讯列表</div>
              <div className="mt-1 text-xs text-zinc-500">公开展示，无需登录（适合分享给朋友）</div>
            </div>
            <div className="text-xs text-zinc-500">
              {data.count === null ? null : (
                <span>
                  约 {data.count} 条 · 第 {f.page} 页
                </span>
              )}
            </div>
          </div>

          <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12" action="/news" method="get">
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-500">公司</label>
              <select
                name="topic"
                defaultValue={f.topic}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                {TOPIC_KEYS.map((k) => (
                  <option key={k} value={k}>{topicDisplayName(k)}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-500">时间</label>
              <select
                name="days"
                defaultValue={f.days}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="ALL">不限</option>
                <option value="1">最近 24h</option>
                <option value="7">最近 7 天</option>
                <option value="30">最近 30 天</option>
              </select>
            </div>
            <div className="md:col-span-6">
              <label className="block text-xs text-zinc-500">搜索</label>
              <input
                name="q"
                defaultValue={f.q}
                placeholder="标题/摘要/来源 关键词"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-500">每页</label>
              <select
                name="pageSize"
                defaultValue={String(f.pageSize)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>

            <input type="hidden" name="page" value="1" />

            <div className="md:col-span-12 flex items-center gap-2">
              <button
                type="submit"
                className="rounded-xl border border-zinc-200 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                应用筛选
              </button>
              <Link
                href={`/news?topic=${DEFAULT_TOPIC}`}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                重置
              </Link>
            </div>
          </form>
        </div>
        <AiDigestPanel key={`${f.topic}|${f.days}|${f.q}`} topic={f.topic} days={f.days} q={f.q} />

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div className="text-xs text-zinc-500">当前：{topicDisplayName(f.topic)}</div>
            <div className="flex items-center gap-2">
              <Link
                href={prevHref ?? "#"}
                aria-disabled={!prevHref}
                className={`rounded-full border px-3 py-1 text-xs ${prevHref ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50" : "border-zinc-100 bg-zinc-50 text-zinc-400"}`}
              >
                上一页
              </Link>
              <Link
                href={nextHref ?? "#"}
                aria-disabled={!nextHref}
                className={`rounded-full border px-3 py-1 text-xs ${nextHref ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50" : "border-zinc-100 bg-zinc-50 text-zinc-400"}`}
              >
                下一页
              </Link>
            </div>
          </div>

          {data.items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">没有匹配的资讯</div>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {data.items.map((it) => {
                const title = (it.title_zh ?? "").trim() || it.title;
                const showOriginal = Boolean(it.title_zh && it.title_zh.trim() && it.title_zh.trim() !== it.title.trim());
                const summary = (it.summary_zh ?? "").trim() || (it.summary ?? "").trim();
                const showSummaryOriginal = Boolean(
                  it.summary_zh && it.summary_zh.trim() && it.summary_zh.trim() !== (it.summary ?? "").trim(),
                );
                return (
                  <li key={it.id} className="px-4 py-4 hover:bg-zinc-50">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-500">{topicDisplayName(it.topic)}</div>
                        <div className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-900">{title}</div>
                        {showOriginal ? <div className="mt-1 line-clamp-1 text-xs text-zinc-400">{it.title}</div> : null}
                        <div className="mt-2 text-xs text-zinc-600">
                          {it.source} · {fmt(it.published_at)}
                        </div>
                        {summary ? (
                          <div className="mt-2">
                            <div className="line-clamp-3 text-sm text-zinc-700">{summary}</div>
                            {showSummaryOriginal ? (
                              <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{it.summary ?? ""}</div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="shrink-0">
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          打开
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
