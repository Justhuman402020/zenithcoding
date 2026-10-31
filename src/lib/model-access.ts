// Pure rules for the per-key model access labels. No network calls here.
export type AccessLabel = "free" | "paid" | "unavailable";

/** Cloudflare Workers AI models that are only offered on the Workers Paid plan. */
export const CF_PAID_ONLY = new Set<string>([
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/black-forest-labs/flux-1-schnell",
  "@cf/leonardo/lucid-origin",
  "@cf/leonardo/phoenix-1.0",
  "@cf/deepgram/aura-1",
  "@cf/deepgram/nova-3",
]);

const PAID_ERROR = /(paid plan|workers paid|upgrade|requires? (a )?(payment|billing|subscription)|insufficient (credit|balance|funds)|payment required|\b402\b|billing)/i;

/** Learns access only from what a key really answered (lastStatus / lastError). */
export function classifyAccess(input: {
  model: string;
  cloudflare: boolean;
  lastStatus: string | null;
  lastError: string | null;
}): AccessLabel {
  if (input.cloudflare && CF_PAID_ONLY.has(input.model)) return "paid";
  if (input.lastError && PAID_ERROR.test(input.lastError)) return "paid";
  if (input.lastStatus === "unauthorized" || input.lastStatus === "unavailable") return "unavailable";
  return "free";
}

export const isSelectable = (label: AccessLabel) => label === "free";

export type KeyAccess = { keyId: string; keyLabel: string; access: AccessLabel; error: string | null };
export type ModelSummary = { model: string; free: number; paid: number; errors: number; keys: KeyAccess[] };

export function summarizeByModel(rows: Array<KeyAccess & { model: string }>): ModelSummary[] {
  const map = new Map<string, ModelSummary>();
  for (const r of rows) {
    const s = map.get(r.model) ?? { model: r.model, free: 0, paid: 0, errors: 0, keys: [] };
    if (r.access === "free") s.free++;
    else if (r.access === "paid") s.paid++;
    else s.errors++;
    s.keys.push({ keyId: r.keyId, keyLabel: r.keyLabel, access: r.access, error: r.error });
    map.set(r.model, s);
  }
  return [...map.values()].sort((a, b) => a.model.localeCompare(b.model));
}

/** Catalog ids not seen before. On the very first check (empty seen list) nothing is "new". */
export function newCatalogIds(catalog: string[], seen: string[]): { toInsert: string[]; markNew: boolean } {
  const known = new Set(seen);
  const toInsert = [...new Set(catalog)].filter((id) => !known.has(id));
  return { toInsert, markNew: seen.length > 0 };
}
