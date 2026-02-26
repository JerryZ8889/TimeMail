import { getOptionalEnv } from "../../../lib/env";
import { createSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { translateItemsToZh } from "../../../server/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

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

  const { data: items, error: queryErr } = await supabase
    .from("news_item")
    .select("id,title,summary,language")
    .is("title_zh", null)
    .not("language", "in", '("zh","zh-cn","zh-hans")')
    .order("published_at", { ascending: false })
    .limit(10);

  if (queryErr) {
    return Response.json({ ok: false, error: queryErr.message }, { status: 500 });
  }

  if (!items || items.length === 0) {
    return Response.json({ ok: true, translated: 0, remaining: 0 });
  }

  try {
    const translated = await translateItemsToZh(
      items.map((it) => ({ title: it.title, summary: it.summary })),
    );

    for (let i = 0; i < items.length; i++) {
      const tr = translated[i];
      if (!tr) continue;
      await supabase
        .from("news_item")
        .update({ title_zh: tr.titleZh, summary_zh: tr.summaryZh })
        .eq("id", items[i].id);
    }
  } catch {
    // best-effort: some may have been translated
  }

  const { count } = await supabase
    .from("news_item")
    .select("id", { count: "exact", head: true })
    .is("title_zh", null)
    .not("language", "in", '("zh","zh-cn","zh-hans")');

  return Response.json({ ok: true, translated: items.length, remaining: count ?? 0 });
}
