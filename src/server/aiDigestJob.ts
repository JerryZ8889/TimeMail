import { getOptionalEnv } from "../lib/env";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import type { NewsItemRow } from "../lib/types";
import type { AiDigest } from "./aiDigest";
import { buildAiDigest, pickTopNewsIndices } from "./aiDigest";

export type AiDigestJobStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";

export type AiDigestJobRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: AiDigestJobStatus;
  run_token?: string;
  topic: "CATL" | "XIAOMI";
  days: "1" | "7" | "30" | "ALL";
  q: string;
  candidate_limit: number;
  max_items: number;
  attempt: number;
  next_run_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  candidate_count: number | null;
  error_message: string | null;
  picked: unknown | null;
  digest: unknown | null;
};

export type AiDigestJobResponse = {
  id: string;
  status: AiDigestJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  attempt: number;
  nextRunAt: string | null;
  errorMessage: string | null;
  digest: AiDigest | null;
  picked: Array<{ i: number; title: string; source: string; published_at: string; url: string }> | null;
};

function sanitizeQuery(q: string): string {
  return q.replaceAll("%", " ").replaceAll("_", " ").trim().slice(0, 80);
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeSince(days: "1" | "7" | "30" | "ALL"): string | null {
  if (days === "ALL") return null;
  const n = Number.parseInt(days, 10);
  const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return since.toISOString();
}

function parseDigest(v: unknown): AiDigest | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (typeof obj.overall !== "string") return null;
  if (!Array.isArray(obj.majorChanges) || !Array.isArray(obj.bullish) || !Array.isArray(obj.bearish) || !Array.isArray(obj.watch)) return null;
  return obj as unknown as AiDigest;
}

function parsePicked(v: unknown): Array<{ i: number; title: string; source: string; published_at: string; url: string }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ i: number; title: string; source: string; published_at: string; url: string }> = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const i = typeof r.i === "number" ? r.i : Number.NaN;
    const title = typeof r.title === "string" ? r.title : "";
    const source = typeof r.source === "string" ? r.source : "";
    const published_at = typeof r.published_at === "string" ? r.published_at : "";
    const url = typeof r.url === "string" ? r.url : "";
    if (!Number.isFinite(i) || !title || !url) continue;
    out.push({ i, title, source, published_at, url });
  }
  return out.length ? out : [];
}

export async function getJob(jobId: string): Promise<AiDigestJobResponse | null> {
  const supabase = createSupabaseAdmin();
  const { data } = await supabase.from("ai_digest_job").select("*").eq("id", jobId).maybeSingle();
  if (!data) return null;
  const row = data as AiDigestJobRow;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    attempt: row.attempt,
    nextRunAt: row.next_run_at,
    errorMessage: row.error_message,
    digest: parseDigest(row.digest),
    picked: parsePicked(row.picked),
  };
}

export async function findRecentSuccess(params: { topic: "CATL" | "XIAOMI"; days: "1" | "7" | "30" | "ALL"; q: string }) {
  const supabase = createSupabaseAdmin();
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("ai_digest_job")
    .select("*")
    .eq("topic", params.topic)
    .eq("days", params.days)
    .eq("q", sanitizeQuery(params.q))
    .eq("status", "SUCCESS")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data?.[0] ?? null) as AiDigestJobRow | null;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    attempt: row.attempt,
    nextRunAt: row.next_run_at,
    errorMessage: row.error_message,
    digest: parseDigest(row.digest),
    picked: parsePicked(row.picked),
  } satisfies AiDigestJobResponse;
}

export async function createJob(params: { topic: "CATL" | "XIAOMI"; days: "1" | "7" | "30" | "ALL"; q: string }) {
  const supabase = createSupabaseAdmin();
  const now = nowIso();
  const q = sanitizeQuery(params.q);
  const candidateLimit = 200;
  const maxItems = Number.parseInt(getOptionalEnv("AI_DIGEST_MAX_ITEMS") ?? "30", 10);
  const max = Number.isFinite(maxItems) ? Math.max(5, Math.min(60, maxItems)) : 30;
  const { data, error } = await supabase
    .from("ai_digest_job")
    .insert({
      status: "QUEUED",
      topic: params.topic,
      days: params.days,
      q,
      candidate_limit: candidateLimit,
      max_items: max,
      attempt: 0,
      next_run_at: null,
      started_at: null,
      ended_at: null,
      candidate_count: null,
      error_message: null,
      picked: null,
      digest: null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;
  const row = data as AiDigestJobRow;
  return { id: row.id, runToken: row.run_token ?? "" };
}

async function loadCandidates(params: { topic: "CATL" | "XIAOMI"; days: "1" | "7" | "30" | "ALL"; q: string; limit: number }) {
  const supabase = createSupabaseAdmin();
  const since = computeSince(params.days);
  const q = sanitizeQuery(params.q);

  let query = supabase
    .from("news_item")
    .select("topic,title,title_zh,summary,summary_zh,source,published_at,url")
    .order("published_at", { ascending: false })
    .eq("topic", params.topic);

  if (since) {
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

  const to = Math.max(0, Math.min(500, params.limit) - 1);
  const { data } = await query.range(0, to);
  return (data ?? []) as Array<
    Pick<NewsItemRow, "topic" | "title" | "title_zh" | "summary" | "summary_zh" | "source" | "published_at" | "url">
  >;
}

function isRetryable429(message: string): boolean {
  return message.includes("HTTP 429") || message.includes("限流") || message.includes("Too Many Requests");
}

function computeNextRun(attempt: number): string {
  const seconds = Math.min(600, 30 + attempt * 45);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function tryClaimJob(jobId: string): Promise<boolean> {
  const supabase = createSupabaseAdmin();
  const now = nowIso();
  const { data } = await supabase
    .from("ai_digest_job")
    .update({ status: "RUNNING", started_at: now, updated_at: now, error_message: null })
    .eq("id", jobId)
    .in("status", ["QUEUED"])
    .select("id");
  return Boolean(data?.length);
}

export async function processJob(jobId: string): Promise<void> {
  const supabase = createSupabaseAdmin();
  const rowRes = await supabase.from("ai_digest_job").select("*").eq("id", jobId).maybeSingle();
  const row = (rowRes.data ?? null) as AiDigestJobRow | null;
  if (!row) return;
  if (row.status === "SUCCESS" || row.status === "RUNNING") return;

  const claimed = await tryClaimJob(jobId);
  if (!claimed) return;

  try {
    const candidates = await loadCandidates({
      topic: row.topic,
      days: row.days,
      q: row.q,
      limit: row.candidate_limit || 200,
    });

    const maxItems = row.max_items || 30;
    const pickedIdx = candidates.length > maxItems ? await pickTopNewsIndices({ candidates, maxItems }) : candidates.map((_, i) => i);
    const pickedFallback = pickedIdx.length ? pickedIdx : candidates.slice(0, maxItems).map((_, i) => i);

    const selected = pickedFallback.map((i) => candidates[i]).filter(Boolean).slice(0, maxItems);
    const digest = await buildAiDigest({ items: selected, topic: row.topic, q: row.q, days: row.days });
    if (!digest) throw new Error("AI 解读未启用或未配置 Key");

    const picked = pickedFallback
      .map((i) => {
        const it = candidates[i];
        if (!it) return null;
        const title = (it.title_zh ?? "").trim() || it.title;
        return { i, title, source: it.source, published_at: it.published_at, url: it.url };
      })
      .filter(Boolean)
      .slice(0, maxItems);

    const now = nowIso();
    await supabase
      .from("ai_digest_job")
      .update({
        status: "SUCCESS",
        updated_at: now,
        ended_at: now,
        candidate_count: candidates.length,
        attempt: row.attempt,
        next_run_at: null,
        error_message: null,
        picked,
        digest,
      })
      .eq("id", jobId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI 解读失败";
    const now = nowIso();
    if (isRetryable429(message)) {
      const next = computeNextRun((row.attempt ?? 0) + 1);
      await supabase
        .from("ai_digest_job")
        .update({
          status: "QUEUED",
          updated_at: now,
          ended_at: null,
          attempt: (row.attempt ?? 0) + 1,
          next_run_at: next,
          error_message: message,
        })
        .eq("id", jobId);
      return;
    }
    await supabase
      .from("ai_digest_job")
      .update({
        status: "FAILED",
        updated_at: now,
        ended_at: now,
        attempt: (row.attempt ?? 0) + 1,
        next_run_at: null,
        error_message: message,
      })
      .eq("id", jobId);
  }
}

export async function processNextJob(): Promise<string | null> {
  const supabase = createSupabaseAdmin();
  const now = nowIso();
  const { data } = await supabase
    .from("ai_digest_job")
    .select("id")
    .eq("status", "QUEUED")
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(1);
  const id = (data?.[0]?.id as string | undefined) ?? null;
  if (!id) return null;
  await processJob(id);
  return id;
}
