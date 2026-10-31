import { engineFor, type BuildEngine } from "./owner-policy";
import { catalogModels } from "./openrouter-catalog";
export async function readWorkspaceAI() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("workspace_ai_settings").select("*").eq("id", "global").maybeSingle();
  return { chatEngine: data?.chat_engine ?? "openrouter", engine: (data?.build_engine ?? "openrouter") as BuildEngine, text: data?.text_provider && data.text_model ? { provider: data.text_provider, model: data.text_model } : null, image: data?.image_provider && data.image_model ? { provider: data.image_provider, model: data.image_model } : null };
}
export async function workspacePick(mode: "plan" | "build", snapshot: BuildEngine | null, images: boolean) {
  const settings = await readWorkspaceAI();
  return { engine: engineFor(mode, settings.engine, snapshot), ref: images ? settings.image : settings.text };
}
export async function recordNeuronCall(row: { user_id?: string; project_id?: string; chat_id?: string; request_key?: string; section: "chat" | "plan" | "build"; provider_id: string; key_number?: number; model: string; step?: number; input_tokens?: number; output_tokens?: number; neurons: number; source?: string; action?: string; status?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("neuron_call_ledger").insert(row);
  if (error) throw new Error("Could not save Neuron usage");
}
export const BUILD_ROUTER_ID = "build-openrouter";
const ROUTER_URL = "https://openrouter.ai/api/v1";
/** Lists models reachable with a pasted OpenRouter key; also proves the key works. */
export async function routerModels(apiKey: string) {
  const key = apiKey.trim().replace(/^Bearer\s+/i, "");
  const auth = await fetch(`${ROUTER_URL}/key`, { headers: { Authorization: `Bearer ${key}` } });
  if (!auth.ok) return { ok: false as const, error: auth.status === 401 ? "OpenRouter rejected this key" : `OpenRouter ${auth.status}` };
  const res = await fetch(`${ROUTER_URL}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return { ok: false as const, error: `OpenRouter ${res.status}` };
  const j = (await res.json()) as { data?: Array<Record<string, any>> };
  const models = catalogModels(j.data ?? []);
  return { ok: true as const, models };
}
export async function readBuildRouterKey() {
  const { getIntegrationKey } = await import("./integration-keys.server");
  return getIntegrationKey("build_openrouter", "apiKey");
}
export async function saveBuildRouterKey(apiKey: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encryptSecret } = await import("./secrets-crypto.server");
  const { error } = await supabaseAdmin.from("platform_integration_keys" as any).upsert({ service: "build_openrouter", field: "apiKey", value_encrypted: await encryptSecret(apiKey.trim().replace(/^Bearer\s+/i, "")), updated_by: userId, updated_at: new Date().toISOString() } as any);
  if (error) throw new Error("Could not activate key");
}
/** Saves one model reply for Recent models. Never throws: logging must not block work. */
export async function recordModelCall(row: { user_id: string; project_id?: string | null; chat_id?: string | null; provider: string; model: string; base_url?: string | null; section: string; key_index?: number | null; started_at: number; first_token_at?: number | null; status: "ok" | "failed"; error?: string | null }) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = Date.now();
    await supabaseAdmin.from("model_call_log").insert({
      user_id: row.user_id, project_id: row.project_id ?? null, chat_id: row.chat_id ?? null,
      provider: row.provider, model: row.model, base_url: row.base_url ?? null, section: row.section,
      key_index: row.key_index ?? null, started_at: new Date(row.started_at).toISOString(),
      first_token_ms: row.first_token_at ? row.first_token_at - row.started_at : null,
      total_ms: now - row.started_at, status: row.status, error_short: row.error ? String(row.error).slice(0, 160) : null,
    });
  } catch { /* ignore */ }
}
