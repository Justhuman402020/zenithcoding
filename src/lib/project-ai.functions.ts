import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwnsProject } from "./project-secrets.server";
import { AI_TOKEN_KEY, AI_URL_KEY, canEnable, rewirePrompt } from "./project-ai-policy";

/** Owner's projects with their "Use Cloudflare" switch and status. */
export const listProjectAi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: projects } = await context.supabase.from("projects").select("id,name,updated_at").eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(300);
    const { data: settings } = await context.supabase.from("project_ai_settings").select("project_id,cloudflare_enabled,status,last_error,last_reply,last_checked_at,day_requests,usage_day");
    const by = new Map((settings ?? []).map((s) => [s.project_id, s]));
    return (projects ?? []).map((p) => ({ id: p.id, name: p.name, ...(by.get(p.id) ?? { cloudflare_enabled: false, status: "off", last_error: null, last_reply: null, last_checked_at: null, day_requests: 0, usage_day: null }) }));
  });

export const setProjectCloudflare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; enabled: boolean; origin: string }) => z.object({ projectId: z.string().uuid(), enabled: z.boolean(), origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!data.enabled) {
      await supabaseAdmin.from("project_ai_settings").upsert({ project_id: data.projectId, user_id: context.userId, cloudflare_enabled: false, status: "off", updated_at: new Date().toISOString() });
      return { ok: true as const, status: "off", prompt: null };
    }
    const { readPoolSettings } = await import("./cf-pool-settings.server");
    const gate = canEnable((await readPoolSettings()).poolEnabled);
    if (!gate.ok) return { ok: false as const, error: gate.reason };
    const { newSiteToken, hashSiteToken } = await import("./project-ai.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const token = newSiteToken();
    const url = `${new URL(data.origin).origin}/api/public/sites/ai/chat`;
    for (const [key, value, description] of [[AI_URL_KEY, url, "Code Haven AI chat address (Cloudflare)"], [AI_TOKEN_KEY, token, "Code Haven site AI key for this project only"]] as const) {
      const { error } = await supabaseAdmin.from("project_secrets").upsert({ project_id: data.projectId, user_id: context.userId, key, value_encrypted: await encryptSecret(value), expose_to_client: true, description }, { onConflict: "project_id,key" });
      if (error) throw new Error(error.message);
    }
    const { error } = await supabaseAdmin.from("project_ai_settings").upsert({ project_id: data.projectId, user_id: context.userId, cloudflare_enabled: true, status: "setting_up", token_hash: await hashSiteToken(token), last_error: null, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true as const, status: "setting_up", prompt: rewirePrompt() };
  });

/** Sends one real test message through the project's Cloudflare connection. */
export const testProjectCloudflare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin.from("project_ai_settings").select("cloudflare_enabled,model").eq("project_id", data.projectId).maybeSingle();
    if (!s?.cloudflare_enabled) return { ok: false, error: "Turn the switch on first." };
    const { runSiteChat } = await import("./project-ai.server");
    const r = await runSiteChat({ projectId: data.projectId, userId: context.userId, stream: false, model: s.model, messages: [{ role: "user", content: "Reply with one short friendly sentence." }] });
    const ok = r.ok && "reply" in r && !!r.reply;
    await supabaseAdmin.from("project_ai_settings").update({ status: ok ? "on" : "needs_fix", last_reply: ok ? (r as any).reply.slice(0, 300) : null, last_error: ok ? null : (r as any).error ?? "Empty reply", last_checked_at: new Date().toISOString() }).eq("project_id", data.projectId);
    return ok ? { ok: true, reply: (r as any).reply as string } : { ok: false, error: String((r as any).error ?? "Empty reply") };
  });
