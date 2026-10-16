export type PoolSettings = { poolEnabled: boolean; capEnabled: boolean; cap: number };

/** Defaults to OFF when the row or columns are missing — never call Cloudflare by accident. */
export async function readPoolSettings(): Promise<PoolSettings> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_pool_settings")
      .select("cloudflare_pool_enabled, run_cap_enabled, run_cap" as any)
      .eq("id", "global")
      .maybeSingle();
    const d = data as any;
    return { poolEnabled: d?.cloudflare_pool_enabled === true, capEnabled: d?.run_cap_enabled === true, cap: Number(d?.run_cap ?? 0) };
  } catch {
    return { poolEnabled: false, capEnabled: false, cap: 0 };
  }
}
