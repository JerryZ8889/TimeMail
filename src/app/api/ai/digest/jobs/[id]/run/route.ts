import { getOptionalEnv } from "../../../../../../../lib/env";
import { createSupabaseAdmin } from "../../../../../../../lib/supabaseAdmin";
import { processJob } from "../../../../../../../server/aiDigestJob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { runToken?: string };

function verifyCronAuth(req: Request): boolean {
  const secret = getOptionalEnv("CRON_SECRET");
  if (!secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const { id } = await ctx.params;
  if (!verifyCronAuth(req)) {
    const token = body.runToken ?? "";
    if (!token) return new Response("Unauthorized", { status: 401 });
    const supabase = createSupabaseAdmin();
    const { data } = await supabase.from("ai_digest_job").select("run_token").eq("id", id).maybeSingle();
    const expected = (data as { run_token?: string } | null)?.run_token ?? "";
    if (!expected || expected !== token) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  await processJob(id);
  return Response.json({ ok: true });
}
