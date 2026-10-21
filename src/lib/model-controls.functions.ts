import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertModelsAdmin } from "./admin-auth.server";

export type EditorModelOption = {
  provider: string;
  providerLabel: string;
  keyLabel: string;
  keyNumber: number | null;
  model: string;
  label: string;
  vision: boolean;
  status: "working" | "unknown";
};

const BAD_CF_MODEL = /(glm[-_. ]?5\.2|deepseek.*distill|embedding|rerank|guard|whisper|tts)/i;
const FREE_CF_CODER = /(qwen|glm[-_. ]?4)/i;

async function loadControls(refresh = false) {
  const { loadProviderRegistry } = await import("./model-router.server");
  const { listProviderModels, clearModelDiscoveryCache } = await import("./model-discovery.server");
  const { isCloudflareBaseUrl, loadCloudflarePool } = await import("./cloudflare-pool.server");
  const { providers, keys } = await loadProviderRegistry();
  if (refresh) clearModelDiscoveryCache();
  const pool = await loadCloudflarePool();
  const keyPosition = new Map(pool.map((key) => [key.id, key.position]));
  const options: EditorModelOption[] = [];
  for (const provider of providers) {
    const key = keys[provider.id];
    if (!key) continue;
    const models = await listProviderModels(provider.id, key, provider, refresh);
    for (const model of models) {
      if (!model.tools && !model.vision) continue;
      const cloudflare = isCloudflareBaseUrl(provider.baseURL);
      if (cloudflare && BAD_CF_MODEL.test(model.id)) continue;
      if (cloudflare && !model.vision && !FREE_CF_CODER.test(model.id)) continue;
      options.push({
        provider: provider.id,
        providerLabel: cloudflare ? "Cloudflare" : provider.label.replace(/\s+#\d+$/, ""),
        keyLabel: provider.label,
        keyNumber: keyPosition.get(provider.id) ?? null,
        model: model.id,
        label: model.label,
        vision: model.vision,
        status: "working",
      });
    }
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings } = await supabaseAdmin.from("ai_pool_settings").select("coding_model,vision_provider,vision_model").eq("id", "global").maybeSingle();
  return {
    vision: options.filter((option) => option.vision),
    coding: options.filter((option) => option.keyNumber != null),
    settings: settings ?? { coding_model: "@cf/qwen/qwen3.8-27b", vision_provider: null, vision_model: null },
  };
}

export const getEditorModelControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => loadControls(false));

export const refreshEditorModelControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => loadControls(true));

export const savePoolModelSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { codingModel?: string; visionProvider?: string | null; visionModel?: string | null }) =>
    z.object({ codingModel: z.string().min(2).optional(), visionProvider: z.string().nullable().optional(), visionModel: z.string().nullable().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = {
      id: "global",
      ...(data.codingModel ? { coding_model: data.codingModel } : {}),
      ...(data.visionProvider !== undefined ? { vision_provider: data.visionProvider } : {}),
      ...(data.visionModel !== undefined ? { vision_model: data.visionModel } : {}),
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    const { error } = await supabaseAdmin.from("ai_pool_settings").upsert(patch);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
