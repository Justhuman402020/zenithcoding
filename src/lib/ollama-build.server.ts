import { ollamaBase, assertChatUrlAllowed } from "./assistant-policy";

export const OLLAMA_BUILD_HEADER = "x-forge-build-provider";

/**
 * Owner-chosen Ollama build: uses the active Chat helper key/model.
 * Never falls back to OpenRouter — an offline tunnel stops the build with a clear message.
 */
export async function loadOllamaBuild(userId: string): Promise<
  { ok: true; providerId: string; baseURL: string; apiKey: string; model: string; label: string } | { ok: false; message: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any).from("ollama_keys").select("id,label,base_url,key_encrypted,active,active_model").eq("user_id", userId).eq("active", true).not("active_model", "is", null).order("created_at").limit(1).maybeSingle();
  if (!data?.active_model) return { ok: false, message: "No Ollama model is turned on. Open Admin → AI Models → Chat helper keys, tap Activate on your Ollama key and pick a model, then try again." };
  const base = ollamaBase(data.base_url);
  assertChatUrlAllowed(base);
  const { decryptSecret } = await import("./secrets-crypto.server");
  const apiKey = (await decryptSecret(data.key_encrypted)) || "ollama";
  let status = 0;
  try {
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    if (res.ok) return { ok: true, providerId: `ollama-${data.id}`, baseURL: `${base}/v1`, apiKey, model: data.active_model, label: data.label ?? "Ollama" };
  } catch { /* offline */ }
  return { ok: false, message: `Your Ollama tunnel is offline${status ? ` (it answered ${status})` : ""}, so the build was stopped. Nothing was changed. On your computer, start Ollama and the tunnel again, save the new address in Admin → AI Models → Chat helper keys, then send the build again.` };
}
