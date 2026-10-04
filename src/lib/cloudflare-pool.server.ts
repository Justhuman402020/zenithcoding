// Cloudflare Workers AI key pool: up to 21 accounts, each with a free daily
// allowance of 10,000 Neurons that resets at 00:00 UTC. Requests run on key #1
// and waterfall to #2, #3… when a key runs out or answers 429.

export const NEURONS_PER_KEY = 10_000;
export const MAX_POOL_KEYS = 100;
/** Hand off to the next key at 9,000 so every key keeps a 1,000 Neuron reserve. */
export const SOFT_CAP_NEURONS = 9_000;
export const CLOUDFLARE_CODING_MODEL = "@cf/qwen/qwen3.8-27b";
const CF_RE = /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai/i;

export const isCloudflareBaseUrl = (url: string) => CF_RE.test(url);

export async function readCloudflareCodingModel() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("ai_pool_settings").select("coding_model").eq("id", "global").maybeSingle();
    return data?.coding_model || CLOUDFLARE_CODING_MODEL;
  } catch {
    return CLOUDFLARE_CODING_MODEL;
  }
}
export const utcDay = () => new Date().toISOString().slice(0, 10);
export function nextResetAt() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

/** Approximate Neurons from token usage (Qwen coder: ~60k/M input, ~91k/M output). */
export function estimateNeurons(inputTokens: number | null | undefined, outputTokens: number | null | undefined) {
  return Math.ceil((inputTokens ?? 0) * 0.06 + (outputTokens ?? 0) * 0.0909);
}

export type PoolKey = {
  id: string;
  label: string;
  position: number;
  used: number;
  remaining: number;
  status: "active" | "waiting" | "exhausted";
  /** "cloudflare" = real count read from Cloudflare; "estimate" = Forge's own count. */
  source: "cloudflare" | "estimate";
};

const realCache = new Map<string, { at: number; neurons: number | null }>();

/** Reads today's real Neurons used for one account from Cloudflare's analytics API. */
export async function fetchRealNeurons(accountId: string, token: string): Promise<number | null> {
  const cacheKey = accountId + ":" + token.slice(-6);
  const hit = realCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.neurons;
  let neurons: number | null = null;
  try {
    const query = `query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){aiInferenceAdaptiveGroups(filter:{date_geq:$d},limit:10000){sum{totalNeurons}}}}}`;
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: accountId, d: utcDay() } }),
      signal: AbortSignal.timeout(8000),
    });
    const j: any = await res.json().catch(() => null);
    const groups = j?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (res.ok && Array.isArray(groups) && !j?.errors?.length) {
      neurons = Math.round(groups.reduce((t: number, g: any) => t + Number(g?.sum?.totalNeurons ?? 0), 0));
    }
  } catch {
    neurons = null;
  }
  realCache.set(cacheKey, { at: Date.now(), neurons });
  return neurons;
}

export async function loadCloudflarePool(): Promise<PoolKey[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("custom_ai_providers")
    .select("id, label, base_url, created_at, pool_position, key_encrypted" as any)
    .order("created_at", { ascending: true });
  const cf = ((rows ?? []) as any[])
    .filter((r) => isCloudflareBaseUrl(r.base_url))
    .sort((a, b) => (a.pool_position ?? 999) - (b.pool_position ?? 999) || a.created_at.localeCompare(b.created_at))
    .slice(0, MAX_POOL_KEYS);
  const { data: usage } = await supabaseAdmin
    .from("cloudflare_neuron_usage" as any)
    .select("provider_id, neurons_used, exhausted")
    .eq("day", utcDay());
  const byId = new Map(((usage ?? []) as any[]).map((u) => [u.provider_id, u]));
  const { decryptSecret } = await import("./secrets-crypto.server");
  const real = await Promise.all(
    cf.map(async (r) => {
      const acct = /accounts\/([^/]+)\//i.exec(r.base_url)?.[1];
      if (!acct || !r.key_encrypted) return null;
      try {
        return await fetchRealNeurons(acct, await decryptSecret(r.key_encrypted));
      } catch {
        return null;
      }
    }),
  );
  let activeSet = false;
  return cf.map((r, i) => {
    const u = byId.get(r.id);
    const realUsed = real[i];
    const source: PoolKey["source"] = realUsed == null ? "estimate" : "cloudflare";
    const used = realUsed ?? Number(u?.neurons_used ?? 0);
    // A 429 from Cloudflare is the truth even if analytics lag behind.
    const remaining = u?.exhausted ? 0 : Math.max(0, NEURONS_PER_KEY - used);
    let status: PoolKey["status"] = remaining <= 0 || used >= SOFT_CAP_NEURONS ? "exhausted" : "waiting";
    if (status === "waiting" && !activeSet) {
      status = "active";
      activeSet = true;
    }
    return { id: r.id, label: r.label, position: i + 1, used, remaining, status, source };
  });
}

async function upsertUsage(providerId: string, patch: (cur: { used: number; exhausted: boolean }) => { used: number; exhausted: boolean }) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const day = utcDay();
    const { data } = await supabaseAdmin
      .from("cloudflare_neuron_usage" as any)
      .select("neurons_used, exhausted")
      .eq("provider_id", providerId)
      .eq("day", day)
      .maybeSingle();
    const next = patch({ used: Number((data as any)?.neurons_used ?? 0), exhausted: !!(data as any)?.exhausted });
    await supabaseAdmin.from("cloudflare_neuron_usage" as any).upsert({
      provider_id: providerId,
      day,
      neurons_used: next.used,
      exhausted: next.exhausted,
      updated_at: new Date().toISOString(),
    } as any);
  } catch {
    /* tracking must never break a build */
  }
}

export const addNeurons = (providerId: string, neurons: number) =>
  upsertUsage(providerId, (c) => ({ used: c.used + neurons, exhausted: c.exhausted || c.used + neurons >= NEURONS_PER_KEY }));

export const markExhausted = (providerId: string) => upsertUsage(providerId, (c) => ({ ...c, exhausted: true }));
