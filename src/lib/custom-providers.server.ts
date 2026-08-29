// Extra AI providers the admin adds from the panel (name + API base URL + key).
// Keys are encrypted at rest and only ever decrypted on the server.

import type { ProviderOption } from "./ai-providers";

export type CustomProviderRow = {
  id: string;
  label: string;
  base_url: string;
  key_encrypted: string;
  created_at: string;
};

export function slugifyProviderId(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `custom-${slug}` : `custom-${Date.now()}`;
}

/** Normalises whatever the admin pastes into an OpenAI-compatible base URL. */
export function normalizeBaseUrl(input: string) {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/(chat\/completions|models)$/i, "");
  return url;
}

export async function loadCustomProviders(): Promise<Array<ProviderOption & { apiKey: string }>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data } = await supabaseAdmin
      .from("custom_ai_providers")
      .select("id, label, base_url, key_encrypted")
      .order("created_at", { ascending: true });
    const out: Array<ProviderOption & { apiKey: string }> = [];
    for (const row of data ?? []) {
      let apiKey = "";
      try {
        apiKey = await decryptSecret(row.key_encrypted as string);
      } catch {
        continue;
      }
      out.push({
        id: row.id as string,
        label: row.label as string,
        envKey: `CUSTOM_${(row.id as string).toUpperCase()}`,
        baseURL: row.base_url as string,
        docs: row.base_url as string,
        models: [],
        apiKey,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Verifies a pasted key by listing the models it can reach. */
export async function testProviderKey(baseURL: string, apiKey: string) {
  try {
    const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false as const, error: `${res.status}: ${text.slice(0, 200) || "request rejected"}`, models: [] };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    if (!models.length) return { ok: false as const, error: "The key worked but no models were returned.", models };
    return { ok: true as const, error: null, models };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not reach that address", models: [] };
  }
}
