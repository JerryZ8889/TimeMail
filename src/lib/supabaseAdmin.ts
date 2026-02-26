import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "./env";

export function createSupabaseAdmin() {
  const url = getRequiredEnv("SUPABASE_URL");
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

