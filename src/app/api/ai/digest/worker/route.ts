import { getOptionalEnv } from "../../../../../lib/env";
import { processNextJob } from "../../../../../server/aiDigestJob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function verifyCronAuth(req: Request): boolean {
  const secret = getOptionalEnv("CRON_SECRET");
  if (!secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!verifyCronAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = await processNextJob();
  return Response.json({ ok: true, processed: id });
}

export async function POST(req: Request) {
  return GET(req);
}

