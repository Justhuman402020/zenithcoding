import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";
import { PROVIDERS } from "./ai-providers";

export type ModelBoardRow = {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  hint: string;
  vision: boolean;
  curated: boolean;
  keyConfigured: boolean;
  active: boolean;
  /** "coding" = text edits, "coding+images" = also understands screenshots. */
  role: "coding" | "coding+images";
  /** 1 = used first, 2 = next backup for plain coding jobs, null = not in the chain. */
  codingRank: number | null;
  /** Position in the backup chain for questions that include an image. */
  imageRank: number | null;
  lastStatus: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  requestsUsed: number;
  remainingRequests: number | null;
  limitRequests: number | null;
  resetAt: string | null;
};

export type ProviderSummary = {
  provider: string;
  providerLabel: string;
  custom: boolean;
  keyConfigured: boolean;
  modelCount: number;
  creditsRemaining: number | null;
  creditsUsed: number | null;
  creditsLimit: number | null;
  creditsNote: string | null;
};


export const getModelBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { loadProviderRegistry, readActiveModelRef } = await import("./model-router.server");
    const { discoverAll } = await import("./model-discovery.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { providers: registry, keys } = await loadProviderRegistry();
    const { ref: active, autoFallback } = await readActiveModelRef();
    const [{ data: statusRows }, discovered] = await Promise.all([
      supabaseAdmin.from("ai_model_status").select("*"),
      discoverAll(keys, registry),
    ]);
    const statusMap = new Map<string, any>();
    for (const row of statusRows ?? []) statusMap.set(`${row.provider}:${row.model}`, row);

    const rows: ModelBoardRow[] = [];
    const providers: ProviderSummary[] = [];

    for (const entry of discovered) {
      const provider = entry.option;
      const keyConfigured = !!keys[entry.provider];
      const custom = !PROVIDERS.some((p) => p.id === provider.id);
      providers.push({
        provider: provider.id,
        providerLabel: provider.label,
        custom,

        keyConfigured,
        modelCount: entry.models.length,
        creditsRemaining: entry.quota?.remaining ?? null,
        creditsUsed: entry.quota?.usage ?? null,
        creditsLimit: entry.quota?.limit ?? null,
        creditsNote: entry.quota?.note ?? null,
      });

      for (const model of entry.models) {
        const status = statusMap.get(`${provider.id}:${model.id}`);
        const used = (status?.requests_used as number) ?? 0;
        const remaining =
          (status?.remaining_requests as number | null) ??
          (model.freeDaily != null ? Math.max(model.freeDaily - used, 0) : null);
        rows.push({
          provider: provider.id,
          providerLabel: provider.label,
          model: model.id,
          label: model.label,
          hint: model.hint,
          vision: model.vision,
          curated: model.curated,
          keyConfigured,
          active: !!active && active.provider === provider.id && active.model === model.id,
          lastStatus: (status?.last_status as string | null) ?? null,
          lastError: (status?.last_error as string | null) ?? null,
          lastUsedAt: (status?.last_used_at as string | null) ?? null,
          requestsUsed: used,
          remainingRequests: remaining,
          limitRequests: (status?.limit_requests as number | null) ?? model.freeDaily ?? null,
          resetAt: (status?.reset_at as string | null) ?? null,
        });
      }
    }

    return { rows, providers, autoFallback, active };
  });

export const setActiveModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { provider: string; model: string; autoFallback?: boolean }) =>
    z
      .object({ provider: z.string().min(1), model: z.string().min(1), autoFallback: z.boolean().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    if (!PROVIDERS.some((p) => p.id === data.provider)) throw new Error("Unknown provider");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_model_settings").upsert({
      id: "global",
      provider: data.provider,
      model: data.model,
      ...(data.autoFallback === undefined ? {} : { auto_fallback: data.autoFallback }),
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const setAutoFallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_model_settings")
      .update({ auto_fallback: data.enabled, updated_at: new Date().toISOString(), updated_by: context.userId })
      .eq("id", "global");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
