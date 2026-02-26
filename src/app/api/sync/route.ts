import { getOptionalEnv } from "../../../lib/env";
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
  const result = await runManualSync({ lookbackHours: 168 });
  return Response.json({ ok: true, result });
}
