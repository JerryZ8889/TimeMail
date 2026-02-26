import { getOptionalEnv } from "../../../../../../../lib/env";
import { processJob } from "../../../../../../../server/aiDigestJob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function verifyCronAuth(req: Request): boolean {
  const secret = getOptionalEnv("CRON_SECRET");
  if (!secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!verifyCronAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  await processJob(id);
  return Response.json({ ok: true });
}

