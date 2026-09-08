import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// User-facing model browser: the full OpenRouter catalogue (400+ models,
// discovered live from the API key) plus the key's credit usage, so anyone can
// pick which model codes their projects. No admin gate.

export const listOpenRouterModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadProviderRegistry } = await import("./model-router.server");
    const { listProviderModels, readProviderQuota } = await import("./model-discovery.server");

    const { keys } = await loadProviderRegistry();
    const apiKey = keys["openrouter"];
    if (!apiKey) {
      return { keyConfigured: false as const, models: [], quota: null };
    }

    const [models, quota] = await Promise.all([
      listProviderModels("openrouter", apiKey),
      readProviderQuota("openrouter", apiKey),
    ]);
    return { keyConfigured: true as const, models, quota };
  });
