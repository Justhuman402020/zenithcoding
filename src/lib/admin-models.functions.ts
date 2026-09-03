import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";
import { PROVIDERS, isFreeModel, isLightweightModel } from "./ai-providers";

export type ModelBoardRow = {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  hint: string;
  vision: boolean;
  curated: boolean;
  free: boolean;
  lightweight: boolean;
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
          free: model.free ?? isFreeModel(provider.id, model.id),
          lightweight: model.lightweight ?? isLightweightModel(model.id),
          keyConfigured,
          active: !!active && active.provider === provider.id && active.model === model.id,
          role: model.vision ? "coding+images" : "coding",
          codingRank: null,
          imageRank: null,
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

    // Show the exact order Forge will fall through when a model runs low,
    // both for plain coding jobs and for questions that carry an image.
    const usable = rows.filter((r) => r.keyConfigured && r.lastStatus !== "unauthorized");
    const order = (list: ModelBoardRow[]) => {
      const chain = [...list].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.curated !== b.curated) return a.curated ? -1 : 1;
        const aOut = a.lastStatus === "rate_limited" || a.remainingRequests === 0;
        const bOut = b.lastStatus === "rate_limited" || b.remainingRequests === 0;
        if (aOut !== bOut) return aOut ? 1 : -1;
        return (b.remainingRequests ?? 0) - (a.remainingRequests ?? 0);
      });
      return chain.slice(0, 12);
    };
    order(usable).forEach((row, i) => (row.codingRank = i + 1));
    order(usable.filter((r) => r.vision)).forEach((row, i) => (row.imageRank = i + 1));

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
    if (!PROVIDERS.some((p) => p.id === data.provider) && !data.provider.startsWith("custom-")) {
      throw new Error("Unknown provider");
    }

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

/** Checks a pasted key by asking the service which models it can reach. */
export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { baseUrl: string; apiKey: string }) =>
    z.object({ baseUrl: z.string().min(3), apiKey: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { normalizeBaseUrl, testProviderKey } = await import("./custom-providers.server");
    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const result = await testProviderKey(baseUrl, data.apiKey.trim());
    return { ...result, baseUrl, models: result.models.slice(0, 50), modelCount: result.models.length };
  });

/** Saves a new provider (encrypted key) so it joins the automatic switching chain.
 *  Any number of keys can be saved for the same service (e.g. two Groq keys) —
 *  each one gets its own slot and its own models on the board. */
export const addProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { label: string; baseUrl: string; apiKey: string }) =>
    z.object({ label: z.string().min(2), baseUrl: z.string().min(3), apiKey: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { normalizeBaseUrl, slugifyProviderId, testProviderKey } = await import("./custom-providers.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const { clearModelCache } = await import("./model-discovery.server");
    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const apiKey = data.apiKey.trim();
    const test = await testProviderKey(baseUrl, apiKey);
    if (!test.ok) throw new Error(`That key did not work — ${test.error}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("custom_ai_providers").select("id, label");
    const taken = new Set((existing ?? []).map((r) => r.id as string));
    const base = slugifyProviderId(data.label);
    let id = base;
    let n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    const sameName = (existing ?? []).filter((r) => (r.label as string).startsWith(data.label.trim())).length;
    const label = sameName ? `${data.label.trim()} (key ${sameName + 1})` : data.label.trim();

    const { error } = await supabaseAdmin.from("custom_ai_providers").insert({
      id,
      label,
      base_url: baseUrl,
      key_encrypted: await encryptSecret(apiKey),
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    clearModelCache(id);
    return { ok: true, id, label, modelCount: test.models.length };
  });

export const removeProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("custom_ai_providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
