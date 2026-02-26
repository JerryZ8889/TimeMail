import { getOptionalEnv } from "../../../lib/env";
import { createSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

type SourceResult = {
  index: number;
  ok: boolean;
  count: number;
  error?: string;
};

type Body = {
  secret?: string;
  windowStart?: string;
  windowEnd?: string;
  sourceResults?: SourceResult[];
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

  const windowStart = body.windowStart ?? null;
  const windowEnd = body.windowEnd ?? null;
  const sourceResults = Array.isArray(body.sourceResults) ? body.sourceResults : [];

  const fetchedCount = sourceResults.reduce((s, r) => s + (r.count ?? 0), 0);
  const successCount = sourceResults.filter((r) => r.ok).length;
  const failedCount = sourceResults.filter((r) => !r.ok).length;
  const hasAnySuccess = successCount > 0;
  const status = hasAnySuccess ? "SUCCESS" : "FAILED";

  const errors = sourceResults
    .filter((r) => !r.ok && r.error)
    .map((r) => `#${r.index}: ${r.error}`)
    .join("; ");
  const errorMessage = errors || null;

  const supabase = createSupabaseAdmin();
  const now = new Date().toISOString();

  await supabase.from("run_log").insert({
    status,
    started_at: now,
    ended_at: now,
    window_start: windowStart,
    window_end: windowEnd,
    fetched_count: fetchedCount,
    deduped_count: 0,
    output_count: fetchedCount,
    error_message: errorMessage,
  });

  if (hasAnySuccess && windowEnd) {
    await supabase
      .from("job_state")
      .upsert(
        { key: "daily_news", last_success_at: windowEnd, updated_at: now },
        { onConflict: "key" },
      );
  }

  return Response.json({
    ok: true,
    result: {
      status,
      windowStart,
      windowEnd,
      fetchedCount,
      successCount,
      failedCount,
      errorMessage,
    },
  });
}
