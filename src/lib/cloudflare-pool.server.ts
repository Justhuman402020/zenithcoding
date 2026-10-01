// Cloudflare Workers AI key pool: up to 21 accounts, each with a free daily
// allowance of 10,000 Neurons that resets at 00:00 UTC. Requests run on key #1
// and waterfall to #2, #3… when a key runs out or answers 429.

export const NEURONS_PER_KEY = 10_000;
export const MAX_POOL_KEYS = 100;
export const CLOUDFLARE_CODING_MODEL = "@cf/qwen/qwen3.8-27b";
const CF_RE = /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai/i;

export const isCloudflareBaseUrl = (url: string) => CF_RE.test(url);
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
};

export async function loadCloudflarePool(): Promise<PoolKey[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("custom_ai_providers")
    .select("id, label, base_url, created_at, pool_position" as any)
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
  let activeSet = false;
  return cf.map((r, i) => {
    const u = byId.get(r.id);
    const used = Number(u?.neurons_used ?? 0);
    const remaining = u?.exhausted ? 0 : Math.max(0, NEURONS_PER_KEY - used);
    let status: PoolKey["status"] = remaining <= 0 ? "exhausted" : "waiting";
    if (status === "waiting" && !activeSet) {
      status = "active";
      activeSet = true;
    }
    return { id: r.id, label: r.label, position: i + 1, used, remaining, status };
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
