import { engineFor, type BuildEngine } from "./owner-policy";
export async function readWorkspaceAI() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("workspace_ai_settings").select("*").eq("id", "global").maybeSingle();
  return { engine: (data?.build_engine ?? "openrouter") as BuildEngine, text: data?.text_provider && data.text_model ? { provider: data.text_provider, model: data.text_model } : null, image: data?.image_provider && data.image_model ? { provider: data.image_provider, model: data.image_model } : null };
}
export async function workspacePick(mode: "plan" | "build", snapshot: BuildEngine | null, images: boolean) {
  const settings = await readWorkspaceAI();
  return { engine: images && mode === "build" ? "openrouter" as const : engineFor(mode, settings.engine, snapshot), ref: images ? settings.image : settings.text };
}
export async function recordNeuronCall(row: { user_id?: string; project_id?: string; chat_id?: string; request_key?: string; section: "chat" | "plan" | "build"; provider_id: string; key_number?: number; model: string; step?: number; input_tokens?: number; output_tokens?: number; neurons: number; source?: string; action?: string; status?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("neuron_call_ledger").insert(row);
  if (error) throw new Error("Could not save Neuron usage");
}