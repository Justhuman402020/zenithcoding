import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertModelsAdmin, isModelsAdmin } from "./admin-auth.server";
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

export const getModelAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ allowed: await isModelsAdmin(context) }));

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
    await assertModelsAdmin(context);
    const { loadProviderRegistry, readActiveModelRef } = await import("./model-router.server");
    const { discoverAll } = await import("./model-discovery.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { providerBaseUrlForKey } = await import("./chat-followups");

  const { providers: registry, keys } = await loadProviderRegistry();
  const { data: savedKeys } = await supabaseAdmin
    .from("project_secrets")
    .select("key, value_encrypted")
    .eq("user_id", context.userId);
  for (const saved of savedKeys ?? []) {
    const providerId = PROVIDERS.find((provider) => provider.envKey === saved.key)?.id;
    if (!providerId || keys[providerId] || !providerBaseUrlForKey(saved.key)) continue;
    try {
      const value = await decryptSecret(saved.value_encrypted);
      if (value.trim()) keys[providerId] = value.trim();
    } catch {
      // Do not surface secret or decryption details to the browser.
    }
  }
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
    await assertModelsAdmin(context);
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
    await assertModelsAdmin(context);
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
    await assertModelsAdmin(context);
    const { normalizeBaseUrl, testProviderKey } = await import("./custom-providers.server");
    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const result = await testProviderKey(baseUrl, data.apiKey.trim());
    return { ...result, baseUrl, models: result.models.slice(0, 50), modelCount: result.models.length };
  });

/** Saves a new provider (encrypted key) so it joins the automatic switching chain. */
export const addProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { label: string; baseUrl: string; apiKey: string }) =>
    z.object({ label: z.string().min(2), baseUrl: z.string().min(3), apiKey: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { normalizeBaseUrl, slugifyProviderId, testProviderKey } = await import("./custom-providers.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const apiKey = data.apiKey.trim();
    const cfPool = await import("./cloudflare-pool.server");
    if (cfPool.isCloudflareBaseUrl(baseUrl) && (await cfPool.loadCloudflarePool()).length >= cfPool.MAX_POOL_KEYS) {
      throw new Error(`The Cloudflare pool is full (${cfPool.MAX_POOL_KEYS} keys). Delete one first.`);
    }
    const test = await testProviderKey(baseUrl, apiKey);
    if (!test.ok) throw new Error(`That key did not work — ${test.error}`);
    // Cloudflare: accept the Meta Llama 3.2 Vision license before saving.
    const licenseOk = cfPool.isCloudflareBaseUrl(baseUrl) ? (await cfPool.agreeMetaLicense(baseUrl, apiKey)).ok : false;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Block saving the exact same token twice, but allow as many different tokens as you like.
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data: existingKeys } = await supabaseAdmin
      .from("custom_ai_providers")
      .select("label, key_encrypted");
    for (const row of existingKeys ?? []) {
      try {
        if ((await decryptSecret(row.key_encrypted as string)).trim() === apiKey) {
          throw new Error(`That token is already saved as "${row.label}" — no need to add it again.`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("already saved")) throw e;
      }
    }
    // Every saved key gets its own id so a second key with the same name never overwrites the first.
    const id = `${slugifyProviderId(data.label)}-${crypto.randomUUID().slice(0, 8)}`;
    // Find the highest "#N" already used for this name and take N+1 (a plain name counts as #1).
    const base = data.label.trim().replace(/\s*#\d+$/, "");
    const { data: siblings } = await supabaseAdmin
      .from("custom_ai_providers")
      .select("label, base_url, pool_position" as any)
      .like("label", `${base}%`);
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${esc}(?:\\s*#(\\d+))?$`);
    let maxN = 0;
    for (const s of (siblings ?? []) as any[]) {
      const m = re.exec(String(s.label).trim());
      if (m) maxN = Math.max(maxN, m[1] ? Number(m[1]) : 1);
    }
    const label = maxN ? `${base} #${maxN + 1}` : base;
    const { isCloudflareBaseUrl } = await import("./cloudflare-pool.server");
    let poolPosition: number | null = null;
    if (isCloudflareBaseUrl(baseUrl)) {
      const { data: cfRows } = await supabaseAdmin
        .from("custom_ai_providers")
        .select("base_url, pool_position" as any);
      const cf = ((cfRows ?? []) as any[]).filter((r) => isCloudflareBaseUrl(r.base_url));
      poolPosition = cf.reduce((mx, r) => Math.max(mx, r.pool_position ?? 0), 0) + 1;
    }
    const { error } = await supabaseAdmin.from("custom_ai_providers").insert({
      id,
      label,
      base_url: baseUrl,
      key_encrypted: await encryptSecret(apiKey),
      created_by: context.userId,
      updated_at: new Date().toISOString(),
      ...(poolPosition ? { pool_position: poolPosition } : {}),
      ...(licenseOk ? { meta_license_agreed_at: new Date().toISOString() } : {}),
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true, id, modelCount: test.models.length };
  });

/** Reads the saved AI Gateway / proxy setting (admin only). */
export const getAiGateway = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertModelsAdmin(context);
    const { readAiGatewaySetting } = await import("./model-router.server");
    return readAiGatewaySetting();
  });

/** Saves (or clears) the AI Gateway / proxy setting. */
export const saveAiGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; enabled: boolean }) =>
    z.object({ url: z.string().max(500), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const url = data.url.trim().replace(/\/+$/, "") || null;
    if (url && !/^https:\/\//i.test(url)) throw new Error("The gateway address must start with https://");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_gateway_settings").upsert({
      id: "global",
      url,
      enabled: data.enabled && !!url,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Checks the gateway address answers before it is saved. */
export const testAiGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string }) => z.object({ url: z.string().min(8).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const base = data.url.trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(base)) return { ok: false, error: "The address must start with https://" };
    try {
      const res = await fetch(`${base}/groq/models`, {
        headers: { Authorization: "Bearer gateway-probe" },
        signal: AbortSignal.timeout(10_000),
      });
      // Any HTTP answer (even 401/404) proves the gateway is reachable.
      return { ok: true, status: res.status };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "No answer from that address" };
    }
  });

export const removeProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("custom_ai_providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cloudflare key pool with today's Neurons per key (null for non-admins). */
export const getCloudflarePool = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isModelsAdmin(context))) return null;
    const { loadCloudflarePool, nextResetAt, NEURONS_PER_KEY, MAX_POOL_KEYS } = await import("./cloudflare-pool.server");
    const keys = await loadCloudflarePool();
    return {
      keys,
      totalUsed: keys.reduce((s, k) => s + k.used, 0),
      totalRemaining: keys.reduce((s, k) => s + k.remaining, 0),
      totalLimit: keys.length * NEURONS_PER_KEY,
      maxKeys: MAX_POOL_KEYS,
      resetAt: nextResetAt(),
    };
  });

/** Moves a Cloudflare key up or down in the 1–21 order. */
export const moveCloudflareKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; direction: "up" | "down" }) =>
    z.object({ id: z.string().min(1), direction: z.enum(["up", "down"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { loadCloudflarePool } = await import("./cloudflare-pool.server");
    const ids = (await loadCloudflarePool()).map((k) => k.id);
    const i = ids.indexOf(data.id);
    const j = data.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let n = 0; n < ids.length; n++) {
      await supabaseAdmin.from("custom_ai_providers").update({ pool_position: n + 1 } as any).eq("id", ids[n]!);
    }
    return { ok: true };
  });

/** Re-tests one saved Cloudflare key by its id. */
export const testSavedProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertModelsAdmin(context);
    const { loadCustomProviders, testProviderKey } = await import("./custom-providers.server");
    const p = (await loadCustomProviders()).find((x) => x.id === data.id);
    if (!p) return { ok: false, error: "Key not found", modelCount: 0 };
    const r = await testProviderKey(p.baseURL, p.apiKey);
    return { ok: r.ok, error: r.error, modelCount: r.models.length };
  });

/** Accepts the Meta Llama 3.2 Vision license on every saved Cloudflare key. */
export const syncCloudflareMetaLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertModelsAdmin(context);
    const { syncMetaLicenseAll } = await import("./cloudflare-pool.server");
    return syncMetaLicenseAll();
  });
