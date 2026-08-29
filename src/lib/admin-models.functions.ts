import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";
import { PROVIDERS, findModel } from "./ai-providers";

export type ModelBoardRow = {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  hint: string;
  vision: boolean;
  keyConfigured: boolean;
  active: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  requestsUsed: number;
  remainingRequests: number | null;
  limitRequests: number | null;
  resetAt: string | null;
};

export const getModelBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { loadProviderKeys, readActiveModelRef } = await import("./model-router.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const keys = loadProviderKeys();
    const { ref: active, autoFallback } = await readActiveModelRef();
    const { data: statusRows } = await supabaseAdmin.from("ai_model_status").select("*");
    const statusMap = new Map<string, any>();
    for (const row of statusRows ?? []) statusMap.set(`${row.provider}:${row.model}`, row);

    const rows: ModelBoardRow[] = PROVIDERS.flatMap((provider) =>
      provider.models.map((model) => {
        const status = statusMap.get(`${provider.id}:${model.id}`);
        const remaining =
          (status?.remaining_requests as number | null) ??
          (model.freeDaily != null ? Math.max(model.freeDaily - ((status?.requests_used as number) ?? 0), 0) : null);
        return {
          provider: provider.id,
          providerLabel: provider.label,
          model: model.id,
          label: model.label,
          hint: model.hint,
          vision: model.vision,
          keyConfigured: !!keys[provider.id],
          active: !!active && active.provider === provider.id && active.model === model.id,
          lastStatus: (status?.last_status as string | null) ?? null,
          lastError: (status?.last_error as string | null) ?? null,
          lastUsedAt: (status?.last_used_at as string | null) ?? null,
          requestsUsed: (status?.requests_used as number) ?? 0,
          remainingRequests: remaining,
          limitRequests: (status?.limit_requests as number | null) ?? model.freeDaily ?? null,
          resetAt: (status?.reset_at as string | null) ?? null,
        };
      }),
    );

    return { rows, autoFallback, active };
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
    if (!findModel(data.provider, data.model)) throw new Error("Unknown model");
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
