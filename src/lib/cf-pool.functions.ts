import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertModelsAdmin } from "./admin-auth.server";

/** Admin-only Cloudflare pool switch + per-run cap. Both default OFF. */
export const getPoolSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertModelsAdmin(context);
    const { readPoolSettings } = await import("./cf-pool-settings.server");
    const s = await readPoolSettings();
    const { loadCloudflarePool } = await import("./cloudflare-pool.server");
    const pool = await loadCloudflarePool().catch(() => []);
    const todayRemaining = pool.length ? pool.reduce((t, k) => t + Math.max(0, 9000 - k.used), 0) : null;
    return { ...s, todayRemaining };
  });

export const savePoolSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean; capEnabled: boolean; cap: number }) =>
    z.object({ enabled: z.boolean(), capEnabled: z.boolean(), cap: z.number().int().min(0).max(10_000_000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_pool_settings")
      .update({
        cloudflare_pool_enabled: data.enabled,
        run_cap_enabled: data.capEnabled,
        run_cap: data.capEnabled ? data.cap : 0,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      } as any)
      .eq("id", "global");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
