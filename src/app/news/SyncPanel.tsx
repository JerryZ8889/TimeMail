"use client";

import { useState } from "react";
import { SOURCE_LIST, SOURCE_COUNT } from "../../config/sources";
import { TOPIC_KEYS, topicDisplayName } from "../../config/topics";

type SourceStatus = "pending" | "fetching" | "success" | "failed";

type SourceState = {
  status: SourceStatus;
  count: number;
  error?: string;
};

export function SyncPanel() {
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sourceStates, setSourceStates] = useState<SourceState[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  const [translating, setTranslating] = useState(false);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);
  const [translateDone, setTranslateDone] = useState(false);

  function resetSources() {
    return Array.from({ length: SOURCE_COUNT }, (): SourceState => ({
      status: "pending",
      count: 0,
    }));
  }

  function updateSource(index: number, patch: Partial<SourceState>) {
    setSourceStates((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function run() {
    if (loading) return;
    if (!secret) {
      setMsg("请输入同步口令");
      return;
    }
    setLoading(true);
    setMsg(null);
    setSyncDone(false);
    setTranslateMsg(null);
    setTranslateDone(false);

    const states = resetSources();
    setSourceStates(states);
    setShowSources(true);

    const now = new Date();
    const windowEnd = now.toISOString();
    const windowStart = new Date(now.getTime() - 168 * 60 * 60 * 1000).toISOString();

    const sourceResults: Array<{ index: number; ok: boolean; count: number; error?: string }> = [];

    for (const source of SOURCE_LIST) {
      const i = source.index;
      updateSource(i, { status: "fetching" });

      try {
        const res = await fetch("/api/sync/source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret,
            sourceIndex: i,
            windowStart,
            windowEnd,
          }),
        });

        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          count?: number;
          errorMessage?: string;
        } | null;

        if (!res.ok && res.status === 401) {
          setMsg("同步失败（口令错误）");
          setLoading(false);
          return;
        }

        if (json?.ok) {
          const count = json.count ?? 0;
          updateSource(i, { status: "success", count });
          sourceResults.push({ index: i, ok: true, count });
        } else {
          const err = json?.errorMessage ?? `HTTP ${res.status}`;
          updateSource(i, { status: "failed", error: err });
          sourceResults.push({ index: i, ok: false, count: 0, error: err });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : "网络错误";
        updateSource(i, { status: "failed", error: err });
        sourceResults.push({ index: i, ok: false, count: 0, error: err });
      }
    }

    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, windowStart, windowEnd, sourceResults }),
      });
    } catch {
      // best-effort
    }

    const totalCount = sourceResults.reduce((s, r) => s + r.count, 0);
    const successSources = sourceResults.filter((r) => r.ok).length;
    const failedSources = sourceResults.filter((r) => !r.ok).length;

    if (successSources > 0) {
      setMsg(`同步完成：${successSources} 个源成功，${failedSources} 个源失败，共 ${totalCount} 条`);
      setSyncDone(true);
    } else {
      setMsg("同步失败：所有源均失败");
    }

    setLoading(false);
  }

  async function translateAll() {
    if (translating) return;
    setTranslating(true);
    setTranslateMsg("翻译中...");
    setTranslateDone(false);
    let totalTranslated = 0;
    try {
      for (;;) {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          translated?: number;
          remaining?: number;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          setTranslateMsg(`翻译出错：${json?.error || `HTTP ${res.status}`}（已翻译 ${totalTranslated} 条）`);
          setTranslating(false);
          return;
        }
        totalTranslated += json.translated ?? 0;
        const remaining = json.remaining ?? 0;
        if (remaining === 0 || (json.translated ?? 0) === 0) {
          setTranslateMsg(`翻译完成，共翻译 ${totalTranslated} 条`);
          setTranslateDone(true);
          setTranslating(false);
          return;
        }
        setTranslateMsg(`翻译中... 已翻译 ${totalTranslated} 条，剩余 ${remaining} 条`);
      }
    } catch (e) {
      setTranslateMsg(`翻译出错：${e instanceof Error ? e.message : "未知错误"}（已翻译 ${totalTranslated} 条）`);
    } finally {
      setTranslating(false);
    }
  }

  const statusIcon = (s: SourceStatus) => {
    if (s === "pending") return "○";
    if (s === "fetching") return "◌";
    if (s === "success") return "●";
    return "✕";
  };

  const statusColor = (s: SourceStatus) => {
    if (s === "pending") return "text-zinc-400";
    if (s === "fetching") return "text-amber-500";
    if (s === "success") return "text-green-600";
    return "text-red-500";
  };

  const grouped = TOPIC_KEYS.map((topic) => ({
    topic,
    displayName: topicDisplayName(topic),
    sources: SOURCE_LIST.filter((s) => s.topic === topic),
  }));

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold">同步</div>
          <div className="mt-1 text-xs text-zinc-500">
            逐源串行抓取 {SOURCE_COUNT} 个数据源，每个最多等待 15 秒
          </div>
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
            className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium ${
              loading ? "border-zinc-200 bg-zinc-50 text-zinc-400" : "border-zinc-200 bg-zinc-900 text-white hover:bg-zinc-800"
            }`}
          >
            {loading ? "同步中..." : "同步"}
          </button>
        </div>
      </div>

      {msg ? <div className="mt-3 text-sm text-zinc-700">{msg}</div> : null}

      {showSources ? (
        <div className="mt-4 space-y-3">
          {grouped.map((g) => (
            <div key={g.topic}>
              <div className="text-xs font-semibold text-zinc-500 mb-1">{g.displayName}</div>
              <div className="space-y-1">
                {g.sources.map((source) => {
                  const st = sourceStates[source.index] ?? { status: "pending", count: 0 };
                  return (
                    <div key={source.index} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 font-mono ${statusColor(st.status)}`}>
                        {statusIcon(st.status)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-zinc-700">
                          <span className={`inline-block w-12 font-medium ${source.type === "gdelt" ? "text-indigo-600" : "text-sky-600"}`}>
                            {source.type === "rss" ? "RSS" : "GDELT"}
                          </span>
                          {source.locale ? (
                            <span className="text-zinc-400 mr-1">{source.locale}</span>
                          ) : null}
                          <span className="text-zinc-500 break-all">{source.query.length > 40 ? `${source.query.slice(0, 40)}...` : source.query}</span>
                        </span>
                      </div>
                      <span className={`whitespace-nowrap ${statusColor(st.status)}`}>
                        {st.status === "pending" ? "等待" : null}
                        {st.status === "fetching" ? "抓取中..." : null}
                        {st.status === "success" ? `${st.count} 条` : null}
                        {st.status === "failed" ? (st.error ? `失败: ${st.error.slice(0, 30)}` : "失败") : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {syncDone ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={translateAll}
            disabled={translating || translateDone}
            className={`rounded-xl border px-4 py-2 text-sm font-medium ${
              translating || translateDone
                ? "border-zinc-200 bg-zinc-50 text-zinc-400"
                : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
            }`}
          >
            {translating ? "翻译中..." : translateDone ? "翻译已完成" : "翻译非中文条目"}
          </button>
          {translateMsg ? <span className="text-xs text-zinc-500">{translateMsg}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
