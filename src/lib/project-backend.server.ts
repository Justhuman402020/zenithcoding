// Reads a project's connected backend (signup/login/data) from its encrypted secrets.
export async function loadProjectBackend(
  projectId: string,
): Promise<{ url: string; anonKey: string; hasServiceKey: boolean } | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data } = await supabaseAdmin
      .from("project_secrets")
      .select("key, value_encrypted")
      .eq("project_id", projectId)
      .in("key", ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
    const rows = data ?? [];
    const get = async (k: string) => {
      const r = rows.find((x) => x.key === k);
      return r ? await decryptSecret(r.value_encrypted) : null;
    };
    const url = await get("VITE_SUPABASE_URL");
    const anonKey = await get("VITE_SUPABASE_ANON_KEY");
    if (!url || !anonKey) return null;
    return { url, anonKey, hasServiceKey: rows.some((r) => r.key === "SUPABASE_SERVICE_ROLE_KEY") };
  } catch {
    return null;
  }
}
