import { getJob } from "../../../../../../server/aiDigestJob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return Response.json({ ok: false, message: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true, job });
}

