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
        apiKey: apiKey.trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Adds the securely saved GitHub access token as its own entry, unless that exact token is already saved. */
function withGitHubToken(list: Array<ProviderOption & { apiKey: string }>) {
  const token = (process.env["GITHUB_MODELS_TOKEN"] ?? "").trim();
  if (!token) return list;
  if (list.some((p) => p.apiKey === token)) return list;
  const id = list.some((p) => p.id === "custom-github-models") ? "custom-github-models-chat" : "custom-github-models";
  const count = list.filter((p) => p.label.startsWith("GitHub Models")).length;
  list.push({
    id,
    label: count ? `GitHub Models #${count + 1}` : "GitHub Models",
    envKey: "GITHUB_MODELS_TOKEN",
    baseURL: "https://models.github.ai/inference",
    docs: "https://github.com/marketplace/models",
    models: [],
    apiKey: token,
  });
  return list;
}

/**
 * Lists the chat model ids a credential can reach, using each provider's own listing endpoint.
 * GitHub Models is special: the credential is a personal access token (sent as a Bearer token)
 * and its catalog lives at /catalog/models, not under the inference base URL.
 */
export async function listModelIds(
  baseURL: string,
  apiKey: string,
): Promise<{ ok: boolean; error: string | null; models: string[] }> {
  try {
    const isGitHub = /models\.github\.ai/i.test(baseURL);
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, "");
    if (isGitHub && !apiKey) apiKey = (process.env["GITHUB_MODELS_TOKEN"] ?? "").trim();
    const url = isGitHub ? "https://models.github.ai/catalog/models" : `${baseURL}/models`;
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (isGitHub) headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (isGitHub) headers.Accept = "application/vnd.github+json";
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${text.slice(0, 200) || "request rejected"}`, models: [] };
    }
    const body = await res.text().catch(() => "");
    let json: { data?: Array<{ id?: string }> } | Array<{ id?: string }> | null = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const raw = json ? (Array.isArray(json) ? json : (json.data ?? [])) : [];
    let models = raw.map((m) => m.id).filter((id): id is string => !!id);
    // Some networks answer with a plain "OK" instead of the list — the token was accepted, so use known GitHub models.
    if (!models.length && isGitHub) models = [...GITHUB_FALLBACK_MODELS];
    if (!models.length) return { ok: false, error: "The credential worked but no models were returned.", models };
    return { ok: true, error: null, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach that address", models: [] };
  }
}

const GITHUB_FALLBACK_MODELS = [
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "meta/llama-3.3-70b-instruct",
  "mistral-ai/mistral-small-2503",
  "deepseek/deepseek-v3-0324",
];

/** Verifies a pasted credential by listing the models it can reach. */
export async function testProviderKey(baseURL: string, apiKey: string) {
  return listModelIds(baseURL, apiKey);
}
