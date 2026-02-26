import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getOptionalEnv } from "../lib/env";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import type { NewsItemRow, RunLogRow } from "../lib/types";

type PageData = {
  envReady: boolean;
  jobLastSuccessAt: string | null;
  latestRun: RunLogRow | null;
  latestItems: NewsItemRow[];
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function statusBadge(status: string | null | undefined): { label: string; cls: string } {
  if (status === "SUCCESS") return { label: "成功", cls: "bg-green-50 text-green-700 border-green-200" };
  if (status === "FAILED") return { label: "失败", cls: "bg-red-50 text-red-700 border-red-200" };
  if (status === "RUNNING") return { label: "运行中", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "未知", cls: "bg-zinc-50 text-zinc-700 border-zinc-200" };
}

async function loadPageData(): Promise<PageData> {
  const envReady = Boolean(getOptionalEnv("SUPABASE_URL") && getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
  if (!envReady) {
    return {
      envReady: false,
      jobLastSuccessAt: null,
      latestRun: null,
      latestItems: [],
    };
  }

  const supabase = createSupabaseAdmin();

  const { data: jobRow } = await supabase
    .from("job_state")
    .select("last_success_at")
    .eq("key", "daily_news")
    .maybeSingle();

  const { data: runRows } = await supabase
    .from("run_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1);

  const latestRun = (runRows?.[0] as RunLogRow | undefined) ?? null;

  const windowStart = latestRun?.window_start ?? null;
  const windowEnd = latestRun?.window_end ?? null;

  let latestItems: NewsItemRow[] = [];
  if (windowStart && windowEnd) {
    const { data: items } = await supabase
      .from("news_item")
      .select("*")
      .gt("published_at", windowStart)
      .lte("published_at", windowEnd)
      .order("published_at", { ascending: false })
      .limit(50);
    latestItems = (items ?? []) as NewsItemRow[];
  }

  return {
    envReady: true,
    jobLastSuccessAt: jobRow?.last_success_at ?? null,
    latestRun,
    latestItems,
  };
}

export default async function Home() {
  const data = await loadPageData();
  const badge = statusBadge(data.latestRun?.status);

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
              <div className="text-xs text-zinc-500">宁德时代 / 小米</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <div className="hidden sm:block">手动触发同步</div>
            <Link
              href="/news?topic=CATL"
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              资讯列表
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">运行状态</div>
                <div className="mt-1 text-xs text-zinc-500">最近一次任务与结果概览</div>
              </div>
              <div className={`rounded-full border px-3 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">最近一次开始</div>
                <div className="mt-1 text-sm font-semibold">{fmt(data.latestRun?.started_at ?? null)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">最近一次结束</div>
                <div className="mt-1 text-sm font-semibold">{fmt(data.latestRun?.ended_at ?? null)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 sm:col-span-2">
                <div className="text-xs text-zinc-500">失败原因（如有）</div>
                <div className="mt-1 text-sm font-semibold text-zinc-800">{data.latestRun?.error_message ?? "-"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div>
              <div className="text-sm font-semibold">增量与去重统计</div>
              <div className="mt-1 text-xs text-zinc-500">按上次成功时间点做增量</div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">上次成功时间点</div>
                <div className="mt-1 text-sm font-semibold">{fmt(data.jobLastSuccessAt)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">本次窗口</div>
                <div className="mt-1 text-sm font-semibold">{fmt(data.latestRun?.window_start ?? null)} → {fmt(data.latestRun?.window_end ?? null)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">抓取条数</div>
                <div className="mt-1 text-sm font-semibold">{data.latestRun?.fetched_count ?? 0}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">去重命中 / 新增条目</div>
                <div className="mt-1 text-sm font-semibold">{data.latestRun?.deduped_count ?? 0} / {data.latestRun?.output_count ?? 0}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">本次窗口新增消息</div>
              <div className="mt-0.5 text-xs text-zinc-500">默认展示最多 50 条</div>
            </div>
          </div>

          {data.latestItems.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">本次窗口内无新增消息</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">公司</th>
                    <th className="px-4 py-3 font-medium">标题</th>
                    <th className="px-4 py-3 font-medium">来源</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">链接</th>
                  </tr>
                </thead>
                <tbody>
                  {data.latestItems.map((it) => (
                    <tr key={it.id} className="border-t border-zinc-200 hover:bg-zinc-50">
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        {it.topic === "CATL" ? "宁德时代" : "小米"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="line-clamp-2 font-medium text-zinc-900">{it.title_zh ?? it.title}</div>
                        {it.title_zh && it.title_zh !== it.title ? (
                          <div className="mt-1 line-clamp-1 text-xs text-zinc-400">{it.title}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{it.source}</td>
                      <td className="px-4 py-3 text-xs text-zinc-600">{fmt(it.published_at)}</td>
                      <td className="px-4 py-3">
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          打开
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
