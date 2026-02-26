"use client";

import { useState } from "react";

type SyncResult = {
  status: "SUCCESS" | "FAILED";
  windowStart: string;
  windowEnd: string;
  fetchedCount: number;
  dedupedCount: number;
  outputCount: number;
  errorMessage?: string | null;
};

export function SyncPanel() {
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function run() {
    if (loading) return;
    setLoading(true);
    setMsg(null);
    setResult(null);
    try {
      if (!secret) {
        setMsg("同步失败（没有输入口令）");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; result?: SyncResult } | null;
      if (!res.ok) {
        if (res.status === 401) {
          setMsg("同步失败（口令错误）");
        } else {
          setMsg(json?.error || `同步失败（HTTP ${res.status}）`);
        }
        setLoading(false);
        return;
      }
      if (!json?.ok || !json.result) {
        setMsg(json?.error || "同步失败");
        setLoading(false);
        return;
      }
      setResult(json.result);
      if (json.result.status === "SUCCESS") {
        setMsg("同步完成");
      } else {
        setMsg(json.result.errorMessage || "同步失败");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "同步失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold">同步</div>
          <div className="mt-1 text-xs text-zinc-500">手动从全网抓取最近 7 天增量并写入数据库（会与库内去重）</div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="同步口令（CRON_SECRET）"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:w-56"
          />
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className={`rounded-xl border px-4 py-2 text-sm font-medium ${
              loading ? "border-zinc-200 bg-zinc-50 text-zinc-400" : "border-zinc-200 bg-zinc-900 text-white hover:bg-zinc-800"
            }`}
          >
            {loading ? "同步中…" : "同步"}
          </button>
        </div>
      </div>

      {msg ? <div className="mt-3 text-sm text-zinc-700">{msg}</div> : null}
      {result ? (
        <div className="mt-3 text-xs text-zinc-500">
          窗口：{result.windowStart} ~ {result.windowEnd}｜抓取 {result.fetchedCount}｜去重 {result.dedupedCount}｜入库 {result.outputCount}
        </div>
      ) : null}
    </div>
  );
}
