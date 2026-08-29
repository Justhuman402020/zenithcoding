// Live model discovery: asks every provider (with a saved API key) which models
// that key can actually use, so the admin board shows all of them instead of a
// short hand-picked list. Results are cached briefly to keep the board snappy.

import {
  PROVIDERS,
  findProvider,
  guessModelMeta,
  isChatModelId,
  type ModelOption,
  type ProviderOption,
} from "./ai-providers";
import type { ProviderKeys } from "./model-router.server";


export type DiscoveredModel = ModelOption & { curated: boolean };

type CacheEntry = { at: number; models: DiscoveredModel[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

/** Provider-level credit/limit info, when the provider exposes it. */
export type ProviderQuota = {
  label: string;
  usage: number | null;
  limit: number | null;
  remaining: number | null;
  note: string | null;
};

export async function listProviderModels(
  providerId: string,
  apiKey: string,
  option?: ProviderOption,
): Promise<DiscoveredModel[]> {
  const provider = option ?? findProvider(providerId);
  if (!provider) return [];

  const cached = cache.get(providerId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.models;


  const curated = new Map(provider.models.map((m) => [m.id, m]));
  let ids: string[] = [];
  try {
    const res = await fetch(`${provider.baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    }
  } catch {
    // fall back to the curated list below
  }

  const merged = new Map<string, DiscoveredModel>();
  for (const model of provider.models) merged.set(model.id, { ...model, curated: true });
  for (const id of ids) {
    if (!isChatModelId(id)) continue;
    if (merged.has(id)) continue;
    merged.set(id, { ...guessModelMeta(providerId, id), curated: false });
  }

  const models = [...merged.values()].sort((a, b) => {
    if (curated.has(a.id) !== curated.has(b.id)) return curated.has(a.id) ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  cache.set(providerId, { at: Date.now(), models });
  return models;
}

/** OpenRouter exposes real credit usage for a key; others do not. */
export async function readProviderQuota(providerId: string, apiKey: string): Promise<ProviderQuota | null> {
  if (providerId !== "openrouter") return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean };
    };
    const d = json.data ?? {};
    const usage = typeof d.usage === "number" ? d.usage : null;
    const limit = typeof d.limit === "number" ? d.limit : null;
    const remaining =
      typeof d.limit_remaining === "number" ? d.limit_remaining : limit != null && usage != null ? limit - usage : null;
    return {
      label: "Key credits",
      usage,
      limit,
      remaining,
      note: d.is_free_tier ? "Free tier key" : null,
    };
  } catch {
    return null;
  }
}

export async function discoverAll(keys: ProviderKeys) {
  const entries = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const key = keys[provider.id];
      if (!key) {
        return {
          provider: provider.id,
          models: provider.models.map((m) => ({ ...m, curated: true })) as DiscoveredModel[],
          quota: null as ProviderQuota | null,
        };
      }
      const [models, quota] = await Promise.all([
        listProviderModels(provider.id, key),
        readProviderQuota(provider.id, key),
      ]);
      return { provider: provider.id, models, quota };
    }),
  );
  return entries;
}
