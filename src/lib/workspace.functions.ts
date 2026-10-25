import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isOwner, sectionTotals } from "./owner-policy";
import type { RouterModel } from "./openrouter-catalog";
export const verifyWorkspaceAccess = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.rpc("workspace_session_allowed");
  if (error) throw new Error("Access check unavailable");
  if (!data) throw new Error("Not available");
  return { allowed: true };
});
export const getWorkspaceAI = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async () => {
  const { readWorkspaceAI } = await import("./workspace-ai.server");
  return readWorkspaceAI();
});
export const saveWorkspaceAI = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ engine: z.enum(["openrouter", "cloudflare"]), chatEngine: z.enum(["openrouter", "ollama"]).optional(), text: z.object({ provider: z.string(), model: z.string() }).nullable(), image: z.object({ provider: z.string(), model: z.string() }).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: user } = await context.supabase.auth.getUser();
    if (!isOwner(user.user)) throw new Error("Not available");
    const { loadProviderRegistry } = await import("./model-router.server");
    const { providers, keys } = await loadProviderRegistry();
    const { BUILD_ROUTER_ID, routerModels } = await import("./workspace-ai.server");
    for (const ref of [data.text, data.image]) {
      if (ref && (ref.provider !== BUILD_ROUTER_ID || !keys[ref.provider] || !providers.some((p) => p.id === ref.provider && /^https:\/\/openrouter\.ai\/api\/v1\/?$/.test(p.baseURL)))) throw new Error("Choose a model from your activated build key");
    }
    if (data.text || data.image) {
      const key = keys[BUILD_ROUTER_ID];
      if (!key) throw new Error("Activate your build key first");
      const catalog = await routerModels(key);
      if (!catalog.ok) throw new Error(catalog.error);
      for (const ref of [data.text, data.image]) if (ref && !catalog.models.some((m) => m.id === ref.model)) throw new Error("This model is no longer in the build key catalog. Refresh models.");
      if (data.image && !catalog.models.find((m) => m.id === data.image?.model)?.vision) throw new Error("This model does not declare image input. Choose an image-capable model.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspace_ai_settings").upsert({ id: "global", build_engine: data.engine, ...(data.chatEngine ? { chat_engine: data.chatEngine } : {}), text_provider: data.text?.provider ?? null, text_model: data.text?.model ?? null, image_provider: data.image?.provider ?? null, image_model: data.image?.model ?? null, updated_at: new Date().toISOString() });
    if (error) throw new Error("Could not save build engine");
    return { ok: true };
  });
export const getNeuronLedger = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await context.supabase.from("neuron_call_ledger").select("*").gte("created_at", `${today}T00:00:00Z`).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw new Error("Could not read Neuron log");
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, totals: sectionTotals(rows) };
});async function ownerOnly(context: any) {
  const { data: user } = await context.supabase.auth.getUser();
  if (!isOwner(user.user)) throw new Error("Not available");
  if (!user.user) throw new Error("Not available");
  return user.user.id;
}
export const testBuildRouterKey = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { apiKey: string }) => z.object({ apiKey: z.string().min(10).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context);
    const { routerModels } = await import("./workspace-ai.server");
    const r = await routerModels(data.apiKey);
    return r.ok ? { ok: true, count: r.models.length, error: null } : { ok: false, count: 0, error: r.error };
  });
export const activateBuildRouterKey = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { apiKey: string }) => z.object({ apiKey: z.string().min(10).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const uid = await ownerOnly(context);
    const { routerModels, saveBuildRouterKey } = await import("./workspace-ai.server");
    const r = await routerModels(data.apiKey);
    if (!r.ok) throw new Error(r.error);
    await saveBuildRouterKey(data.apiKey, uid);
    return { ok: true };
  });
export const getBuildRouterModels = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await ownerOnly(context);
  const { routerModels, readBuildRouterKey, BUILD_ROUTER_ID } = await import("./workspace-ai.server");
  const key = await readBuildRouterKey();
  if (!key) return { active: false, provider: BUILD_ROUTER_ID, models: [] as RouterModel[], error: null as string | null };
  const r = await routerModels(key);
  return { active: true, provider: BUILD_ROUTER_ID, models: r.ok ? r.models : [], error: r.ok ? null : r.error };
});
