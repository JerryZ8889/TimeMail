import { getOptionalEnv } from "../../../lib/env";
import { createSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { runManualSync } from "../../../server/manualSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { secret?: string };

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

  const supabase = createSupabaseAdmin();
  const toEmail = getOptionalEnv("REPORT_TO_EMAIL") ?? "manual";

  const { data: runRow } = await supabase
    .from("run_log")
    .insert({
      status: "RUNNING",
      window_start: null,
      window_end: null,
      email_to: toEmail,
      fetched_count: 0,
      deduped_count: 0,
      output_count: 0,
      error_message: null,
    })
    .select("id")
    .single();

  const runId = (runRow as { id?: string } | null)?.id ?? null;

  const result = await runManualSync({ lookbackHours: 168 });

  if (runId) {
    await supabase
      .from("run_log")
      .update({
        ended_at: new Date().toISOString(),
        status: result.status,
        window_start: result.windowStart,
        window_end: result.windowEnd,
        fetched_count: result.fetchedCount,
        deduped_count: result.dedupedCount,
        output_count: result.outputCount,
        email_to: toEmail,
        error_message: result.errorMessage ?? null,
      })
      .eq("id", runId);
  }

  return Response.json({ ok: true, result });
}
