import { getOptionalEnv } from "../../../../../lib/env";
import { createJob, findRecentSuccess } from "../../../../../server/aiDigestJob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type CreateJobBody = {
  topic?: string;
  days?: string;
  q?: string;
};

function safeTopic(v: unknown): "CATL" | "XIAOMI" {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return s === "XIAOMI" ? "XIAOMI" : "CATL";
}

function safeDays(v: unknown): "1" | "7" | "30" | "ALL" {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "1" || s === "7" || s === "30") return s;
  return "ALL";
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function originFromReq(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CreateJobBody;
  const topic = safeTopic(body.topic);
  const days = safeDays(body.days);
  const q = safeString(body.q);

  const recent = await findRecentSuccess({ topic, days, q });
  if (recent?.digest) {
    return Response.json({ ok: true, job: recent });
  }

  const id = await createJob({ topic, days, q });

  const secret = getOptionalEnv("CRON_SECRET");
  const url = `${originFromReq(req)}/api/ai/digest/jobs/${encodeURIComponent(id)}/run`;
  void fetch(url, {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  }).catch(() => null);

  return Response.json({
    ok: true,
    job: {
      id,
      status: "QUEUED",
    },
  });
}

