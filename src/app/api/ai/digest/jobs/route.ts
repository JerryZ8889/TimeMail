import { createJob, findRecentSuccess } from "../../../../../server/aiDigestJob";
import { safeTopic } from "../../../../../config/topics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type CreateJobBody = {
  topic?: string;
  days?: string;
  q?: string;
};

function safeDays(v: unknown): "1" | "7" | "30" | "ALL" {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "1" || s === "7" || s === "30") return s;
  return "ALL";
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
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

  const created = await createJob({ topic, days, q });

  return Response.json({
    ok: true,
    job: {
      id: created.id,
      runToken: created.runToken,
      status: "QUEUED",
    },
  });
}
