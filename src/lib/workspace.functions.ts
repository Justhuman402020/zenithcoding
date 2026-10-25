import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isOwner, sectionTotals } from "./owner-policy";
const auth = [requireSupabaseAuth];
export const verifyWorkspaceAccess = createServerFn({ method: "GET" }).middleware(auth).handler(async ({ context }) => {
  const { data, error } = await context.supabase.rpc("workspace_session_allowed");
  if (error || !data) throw new Error("Not available");
  return { allowed: true };
});
export const getWorkspaceAI = createServerFn({ method: "GET" }).middleware(auth).handler(async () => {
  const { readWorkspaceAI } = await import("./workspace-ai.server");
  return readWorkspaceAI();
});
export const saveWorkspaceAI = createServerFn({ method: "POST" }).middleware(auth)
  .inputValidator((d) => z.object({ engine: z.enum(["openrouter", "cloudflare"]), text: z.object({ provider: z.string(), model: z.string() }).nullable(), image: z.object({ provider: z.string(), model: z.string() }).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: user } = await context.supabase.auth.getUser();
    if (!isOwner(user.user)) throw new Error("Not available");
    const { loadProviderRegistry } = await import("./model-router.server");
    const { providers, keys } = await loadProviderRegistry();
    for (const ref of [data.text, data.image]) {
      if (ref && (!keys[ref.provider] || !providers.some((p) => p.id === ref.provider && /^https:\/\/openrouter\.ai\/api\/v1\/?$/.test(p.baseURL)))) throw new Error("Choose a saved OpenRouter model");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspace_ai_settings").upsert({ id: "global", build_engine: data.engine, text_provider: data.text?.provider ?? null, text_model: data.text?.model ?? null, image_provider: data.image?.provider ?? null, image_model: data.image?.model ?? null, updated_at: new Date().toISOString() });
    if (error) throw new Error("Could not save build engine");
    return { ok: true };
  });
export const getNeuronLedger = createServerFn({ method: "GET" }).middleware(auth).handler(async ({ context }) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await context.supabase.from("neuron_call_ledger").select("*").gte("created_at", `${today}T00:00:00Z`).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw new Error("Could not read Neuron log");
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, totals: sectionTotals(rows) };
});