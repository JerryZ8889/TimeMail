export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { getOptionalEnv } = await import("../../../lib/env");
  return Response.json({
    ok: true,
    env: {
      hasSupabaseUrl: Boolean(getOptionalEnv("SUPABASE_URL")),
      hasSupabaseServiceRoleKey: Boolean(getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY")),
      hasGlm: Boolean(getOptionalEnv("GLM")),
      hasZhipuApiKey: Boolean(getOptionalEnv("ZHIPU_API_KEY")),
      hasOpenAiApiKey: Boolean(getOptionalEnv("OPENAI_API_KEY")),
      aiDigestEnabled: (getOptionalEnv("AI_DIGEST") ?? "1") !== "0",
    },
  });
}
