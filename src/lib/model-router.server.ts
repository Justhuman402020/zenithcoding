// Cross-provider model routing: pick a model that is actually available right
// now, record what each provider reports about remaining quota, and fall back
// automatically so a coding job never cuts off half way.

import { PROVIDERS, findProvider, type ModelRef, type ProviderOption } from "./ai-providers";

export type ProviderKeys = Record<string, string>;

/** Provider ids that have an API key configured on the server. */
export function loadProviderKeys(): ProviderKeys {
  const keys: ProviderKeys = {};
  for (const provider of PROVIDERS) {
    const value = process.env[provider.envKey];
    if (value && value.trim()) keys[provider.id] = value.trim();
  }
  return keys;
}

/** Built-in providers (env keys) plus any provider the admin added in the panel. */
export async function loadProviderRegistry(): Promise<{ providers: ProviderOption[]; keys: ProviderKeys }> {
  const keys = loadProviderKeys();
  const providers: ProviderOption[] = [...PROVIDERS];
  const { loadCustomProviders } = await import("./custom-providers.server");
  for (const custom of await loadCustomProviders()) {
    const { apiKey, ...option } = custom;
    providers.push(option);
    keys[option.id] = apiKey;
  }
  return { providers, keys };
}


export type QuotaSnapshot = {
  remainingRequests: number | null;
  limitRequests: number | null;
  remainingTokens: number | null;
  limitTokens: number | null;
  resetAt: string | null;
};

function toNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Groq-style durations: "2m59.56s", "1h", "500ms". */
function parseResetAt(value: string | null): string | null {
  if (!value) return null;
  const asDate = Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
  if (asDate) return asDate;
  const seconds = /^(\d+(?:\.\d+)?)s?$/.exec(value.trim());
  if (seconds) return new Date(Date.now() + Number(seconds[1]) * 1000).toISOString();
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const n = Number(match[1]);
    total += match[2] === "ms" ? n / 1000 : match[2] === "s" ? n : match[2] === "m" ? n * 60 : n * 3600;
  }
  return total > 0 ? new Date(Date.now() + total * 1000).toISOString() : null;
}

export function readQuotaHeaders(headers: Headers): QuotaSnapshot {
  const get = (...names: string[]) => {
    for (const name of names) {
      const value = headers.get(name);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    remainingRequests: toNumber(get("x-ratelimit-remaining-requests", "x-ratelimit-remaining", "ratelimit-remaining")),
    limitRequests: toNumber(get("x-ratelimit-limit-requests", "x-ratelimit-limit", "ratelimit-limit")),
    remainingTokens: toNumber(get("x-ratelimit-remaining-tokens")),
    limitTokens: toNumber(get("x-ratelimit-limit-tokens")),
    resetAt: parseResetAt(get("x-ratelimit-reset-requests", "x-ratelimit-reset", "ratelimit-reset", "retry-after")),
  };
}

export async function recordModelStatus(
  ref: ModelRef,
  status: "ok" | "rate_limited" | "unauthorized" | "unavailable",
  quota: QuotaSnapshot | null,
  error?: string | null,
  countRequest = false,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("ai_model_status")
      .select("requests_used")
      .eq("provider", ref.provider)
      .eq("model", ref.model)
      .maybeSingle();
    await supabaseAdmin.from("ai_model_status").upsert(
      {
        provider: ref.provider,
        model: ref.model,
        last_status: status,
        last_error: error ?? null,
        last_used_at: new Date().toISOString(),
        requests_used: ((existing?.requests_used as number | undefined) ?? 0) + (countRequest ? 1 : 0),
        remaining_requests: quota?.remainingRequests ?? null,
        limit_requests: quota?.limitRequests ?? null,
        remaining_tokens: quota?.remainingTokens ?? null,
        limit_tokens: quota?.limitTokens ?? null,
        reset_at: quota?.resetAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,model" },
    );
  } catch {
    // status reporting must never break a build
  }
}

export type ModelPick =
  | { ok: true; ref: ModelRef; apiKey: string; baseURL: string }
  | { ok: false; error: string; status: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reorders a chain so consecutive backups come from *different* API keys.
 * Without this, a chain full of models on one key keeps hitting the same
 * rate limit and a build stalls. The first entry (the chosen model) stays put.
 */
export function spreadAcrossProviders(chain: ModelRef[]): ModelRef[] {
  if (chain.length < 3) return chain;
  const [first, ...rest] = chain;
  const buckets = new Map<string, ModelRef[]>();
  for (const ref of rest) {
    const list = buckets.get(ref.provider) ?? [];
    list.push(ref);
    buckets.set(ref.provider, list);
  }
  const out: ModelRef[] = [first!];
  while (buckets.size) {
    for (const [providerId, list] of [...buckets.entries()]) {
      const next = list.shift();
      if (next) out.push(next);
      if (!list.length) buckets.delete(providerId);
    }
  }
  return out;
}

/**
 * Probes each model in the chain with a tiny request and returns the first one
 * that answers. Rate limited models are skipped (after one Retry-After wait),
 * and once a key is rate limited or rejected the rest of that key's models are
 * skipped too, so the job moves on to a different provider instead of failing.
 */
export async function pickAvailableModel(
  chain: ModelRef[],
  keys: ProviderKeys,
  providers?: ProviderOption[],
): Promise<ModelPick> {
  let rateLimited = false;
  let lastError: string | null = null;
  const exhaustedProviders = new Set<string>();

  for (const ref of spreadAcrossProviders(chain)) {
    if (exhaustedProviders.has(ref.provider)) continue;
    const provider = providers?.find((p) => p.id === ref.provider) ?? findProvider(ref.provider);
    const apiKey = keys[ref.provider];
    if (!provider || !apiKey) continue;



    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${provider.baseURL}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: ref.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await recordModelStatus(ref, "unavailable", null, lastError);
        break;
      }

      const quota = readQuotaHeaders(res.headers);
      if (res.ok) {
        await recordModelStatus(ref, "ok", quota, null, true);
        return { ok: true, ref, apiKey, baseURL: provider.baseURL };
      }

      const text = await res.text().catch(() => "");
      lastError = text.slice(0, 300);

      if (res.status === 429) {
        rateLimited = true;
        await recordModelStatus(ref, "rate_limited", quota, lastError);
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        if (attempt === 0 && retryAfter > 0 && retryAfter <= 8) {
          await sleep(retryAfter * 1000);
          continue;
        }
        // Whole key is throttled: move to a different provider.
        if (quota?.remainingRequests === 0 || retryAfter > 8) exhaustedProviders.add(ref.provider);
        break;
      }
      if (res.status === 401 || res.status === 403) {
        await recordModelStatus(ref, "unauthorized", quota, lastError);
        exhaustedProviders.add(ref.provider);
        break;
      }

      await recordModelStatus(ref, "unavailable", quota, lastError);
      break;
    }
  }

  if (rateLimited) {
    return {
      ok: false,
      status: 429,
      error:
        "Every available model is rate limited right now. Forge already tried the backups — wait about a minute, or pick a different model in the admin panel.",
    };
  }
  return {
    ok: false,
    status: 502,
    error: lastError
      ? `No model is available right now. Last provider said: ${lastError}`
      : "No model is available. Add at least one provider API key.",
  };
}

/** Reads the admin-chosen active model from the database. */
export async function readActiveModelRef(): Promise<{ ref: ModelRef | null; autoFallback: boolean }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_model_settings")
      .select("provider, model, auto_fallback")
      .eq("id", "global")
      .maybeSingle();
    if (!data) return { ref: null, autoFallback: true };
    return {
      ref: { provider: data.provider as string, model: data.model as string },
      autoFallback: data.auto_fallback !== false,
    };
  } catch {
    return { ref: null, autoFallback: true };
  }
}
