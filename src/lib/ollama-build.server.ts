import { ollamaBase, assertChatUrlAllowed } from "./assistant-policy";
import { orderOllamaBuildKeys, modelInstalled } from "./ollama-build-policy";

export const OLLAMA_BUILD_HEADER = "x-forge-build-provider";

/**
 * Owner-chosen Ollama build: uses the most recently turned-on Chat helper key/model.
 * Before starting it checks the tunnel is online AND the chosen model is really installed there;
 * if not, it tries your other turned-on Ollama keys. Never falls back to OpenRouter.
 */
export async function loadOllamaBuild(userId: string): Promise<
  { ok: true; providerId: string; baseURL: string; apiKey: string; model: string; label: string } | { ok: false; message: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any).from("ollama_keys").select("id,label,base_url,key_encrypted,active,active_model,created_at,activated_at").eq("user_id", userId).eq("active", true).not("active_model", "is", null);
  const rows = orderOllamaBuildKeys((data ?? []) as any[]);
  if (!rows.length) return { ok: false, message: "No Ollama model is turned on. Open Admin → AI Models → Chat helper keys, tap Activate on your Ollama key and pick a model, then try again." };
  const { decryptSecret } = await import("./secrets-crypto.server");
  const problems: string[] = [];
  for (const row of rows) {
    const name = `"${row.label ?? "Ollama"}"`;
    let base: string;
    try { base = ollamaBase(row.base_url); assertChatUrlAllowed(base); } catch { problems.push(`${name}: the saved address isn't allowed`); continue; }
    const apiKey = (await decryptSecret(row.key_encrypted)) || "ollama";
    let status = 0;
    let installed: string[] | null = null;
    try {
      const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
      status = res.status;
      if (res.ok) installed = (((await res.json()) as any)?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
    } catch { /* offline */ }
    if (!installed) { problems.push(`${name} is offline${status ? ` (it answered ${status})` : ""}`); continue; }
    if (!modelInstalled(row.active_model, installed)) { problems.push(`${name} doesn't have the model "${row.active_model}" installed`); continue; }
    return { ok: true, providerId: `ollama-${row.id}`, baseURL: `${base}/v1`, apiKey, model: row.active_model, label: row.label ?? "Ollama" };
  }
  return { ok: false, message: `Your Ollama build couldn't start, so nothing was changed: ${problems.join("; ")}. Open Admin → AI Models → Chat helper keys, tap Activate on an online key and pick a model that is installed on it (for building, pick a text or vision chat model such as Qwen3-VL or qwen3:8b — picture-making models like FLUX can't write code), then send the build again.` };
}
