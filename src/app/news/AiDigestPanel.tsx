"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TopicKey } from "../../config/topics";

type AiDigestItem = { title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] };
type AiDigest = {
  overall: string;
  majorChanges: AiDigestItem[];
  bullish: AiDigestItem[];
  bearish: AiDigestItem[];
  watch: AiDigestItem[];
};

type JobStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
type Job = {
  id: string;
  status: JobStatus;
  runToken?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  attempt?: number;
  nextRunAt?: string | null;
  errorMessage?: string | null;
  digest?: AiDigest | null;
};

export function AiDigestPanel(props: {
  topic: TopicKey;
  days: "1" | "7" | "30" | "ALL";
  q: string;
}) {
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<AiDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  const pollTimer = useRef<number | null>(null);

  function clearPoll() {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  useEffect(() => {
    return () => clearPoll();
  }, []);

  async function pollJob(id: string) {
    try {
      const res = await fetch(`/api/ai/digest/jobs/${encodeURIComponent(id)}`, { method: "GET" });
      const json = (await res.json()) as { ok?: boolean; job?: Job; message?: string };
      if (!res.ok || !json?.ok || !json?.job) return;
      setJob(json.job);
      if (json.job.status === "SUCCESS" && json.job.digest) {
        setDigest(json.job.digest);
        setError(null);
        setLoading(false);
        clearPoll();
      } else if (json.job.status === "FAILED") {
        setDigest(null);
        setError(json.job.errorMessage || "AI 解读失败");
        setLoading(false);
        clearPoll();
      }
    } catch {
      return;
    }
  }

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDigest(null);
    setJob(null);
    try {
      const res = await fetch(`/api/ai/digest/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: props.topic, days: props.days, q: props.q }),
      });
      const json = (await res.json()) as { ok?: boolean; job?: Job; message?: string };
      const j = json?.job;
      if (!res.ok || !json?.ok || !j) {
        throw new Error(json?.message || `请求失败（HTTP ${res.status}）`);
      }
      setJob(j);
      if (j.status === "SUCCESS" && j.digest) {
        setDigest(j.digest);
        setLoading(false);
        return;
      }
      if (j.runToken) {
        await fetch(`/api/ai/digest/jobs/${encodeURIComponent(j.id)}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runToken: j.runToken }),
        }).catch(() => null);
      }
      await pollJob(j.id);
      clearPoll();
      pollTimer.current = window.setInterval(() => void pollJob(j.id), 2000);
    } catch (e) {
      setDigest(null);
      setJob(null);
      setError(e instanceof Error ? e.message : "AI 解读失败");
    } finally {
      if (!pollTimer.current) setLoading(false);
    }
  }

  function reset() {
    setDigest(null);
    setError(null);
    setJob(null);
    setLoading(false);
    clearPoll();
  }

  const statusText = useMemo(() => {
    if (!job) return null;
    if (job.status === "QUEUED") {
      if (job.nextRunAt) {
        const t = new Date(job.nextRunAt).getTime();
        const left = Math.max(0, Math.round((t - Date.now()) / 1000));
        return `排队中（预计 ${left}s 后重试）`;
      }
      return "排队中…";
    }
    if (job.status === "RUNNING") return "生成中…";
    if (job.status === "SUCCESS") return "已生成";
    if (job.status === "FAILED") return "生成失败";
    return null;
  }, [job]);

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold">AI 解读</div>
          <div className="mt-1 text-xs text-zinc-500">
            点击生成后才会调用模型；若被限流会自动延迟重试（候选集最多 200 条，先筛 Top 30 再解读）
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className={`rounded-xl border px-4 py-2 text-sm font-medium ${
              loading ? "border-zinc-200 bg-zinc-50 text-zinc-400" : "border-zinc-200 bg-zinc-900 text-white hover:bg-zinc-800"
            }`}
          >
            {loading ? "生成中…" : "生成解读"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            清除
          </button>
        </div>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {statusText ? <div className="mt-3 text-xs text-zinc-500">{statusText}</div> : null}

      {!digest ? (
        <div className="mt-4 text-sm text-zinc-600">暂未生成。</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-xs font-medium text-zinc-500">总体</div>
            <div className="mt-1 text-sm text-zinc-800">{digest.overall}</div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-sm font-semibold text-emerald-700">利多</div>
              {digest.bullish.length ? (
                <ul className="mt-2 space-y-2 text-sm text-zinc-800">
                  {digest.bullish.map((it, idx) => (
                    <li key={`b-${idx}`}>
                      <div className="font-medium">{it.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{it.reason}</div>
                      {it.urls.length ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {it.urls.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">
                              链接
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-zinc-500">无明显利多</div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-sm font-semibold text-rose-700">利空</div>
              {digest.bearish.length ? (
                <ul className="mt-2 space-y-2 text-sm text-zinc-800">
                  {digest.bearish.map((it, idx) => (
                    <li key={`s-${idx}`}>
                      <div className="font-medium">{it.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{it.reason}</div>
                      {it.urls.length ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {it.urls.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">
                              链接
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-zinc-500">无明显利空</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-sm font-semibold">重要变化</div>
              {digest.majorChanges.length ? (
                <ul className="mt-2 space-y-2 text-sm text-zinc-800">
                  {digest.majorChanges.map((it, idx) => (
                    <li key={`m-${idx}`}>
                      <div className="font-medium">{it.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{it.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-zinc-500">无明显大变化</div>
              )}
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-sm font-semibold">关注事项</div>
              {digest.watch.length ? (
                <ul className="mt-2 space-y-2 text-sm text-zinc-800">
                  {digest.watch.map((it, idx) => (
                    <li key={`w-${idx}`}>
                      <div className="font-medium">{it.title}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{it.reason}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-zinc-500">暂无</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
