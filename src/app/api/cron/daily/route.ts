import { getOptionalEnv } from "../../../../lib/env";
import { runDailyCron } from "../../../../server/dailyCron";

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
  const result = await runDailyCron();
  return Response.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
