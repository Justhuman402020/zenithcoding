import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";
import { ACTIVE_SCREENSHOT_ROW, isScreenshotKey, SCREENSHOTONE_BASE_URL } from "./screenshot-key-policy";

type Usage = { total: number; available: number; used: number } | null;

/** ScreenshotOne keys with which one is on and how many screenshots each has left. */
export const listScreenshotKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const [{ data: rows, error }, { data: active }] = await Promise.all([
      supabaseAdmin.from("admin_credentials").select("id, label, base_url, key_encrypted").order("created_at", { ascending: true }),
      supabaseAdmin.from("admin_brain").select("content").eq("id", ACTIVE_SCREENSHOT_ROW).maybeSingle(),
    ]);
    if (error) throw new Error("Could not load screenshot keys.");
    const activeId = (active as any)?.content ?? null;
    const keys = await Promise.all((rows ?? []).filter(isScreenshotKey).map(async (r) => {
      let usage: Usage = null; let problem: string | null = null;
      try {
        const key = await decryptSecret(r.key_encrypted);
        const res = await fetch(`${SCREENSHOTONE_BASE_URL}/usage?access_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) { const j = await res.json() as any; usage = { total: Number(j.total) || 0, available: Number(j.available) || 0, used: Number(j.used) || 0 }; }
        else problem = res.status === 401 || res.status === 403 ? "Key refused" : `Could not read usage (${res.status})`;
      } catch { problem = "Could not read usage"; }
      return { id: r.id, label: r.label, active: r.id === activeId, usage, problem };
    }));
    return { keys };
  });

/** Turns one key on (the agent uses only that one), or turns all off with null. */
export const setActiveScreenshotKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string | null }) => z.object({ id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("admin_brain")
      .upsert({ id: ACTIVE_SCREENSHOT_ROW, content: data.id ?? "", updated_at: new Date().toISOString(), updated_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
