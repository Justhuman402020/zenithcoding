// Side-chat "Chosen models" rules shared by server and UI.
export type ChosenProvider = "ollama" | "openrouter" | "registry";
export type ChosenRef = { provider: ChosenProvider; keyRef: string; model: string };

/** Model ids of one key, unique and A to Z (case-insensitive). */
export function sortModelsAZ(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

/** In Chosen-models mode a chat must have a chosen model; never fall back silently. */
export function requireChosen(chosen: ChosenRef | null | undefined): ChosenRef {
  if (!chosen) throw new Error("No chosen model for this chat. Tap the model list button and pick one of your saved models");
  return chosen;
}

/** Board rows inside one key, A to Z by model id. */
export function sortRowsAZ<T extends { model: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base", numeric: true }));
}

/** Saved keys oldest first, so the newest saved key sits at the bottom. Keys without a date keep their place at the top. */
export function sortKeysBySavedAt<T extends { savedAt?: string | null }>(keys: T[]): T[] {
  const time = (k: T) => (k.savedAt ? Date.parse(k.savedAt) : Number.NEGATIVE_INFINITY);
  return keys.map((k, i) => ({ k, i })).sort((a, b) => time(a.k) - time(b.k) || a.i - b.i).map((x) => x.k);
}

/** Chat picker: keys in the same saved order as the AI Models page (newest key last); only the models inside each key go A to Z. */
export function orderChosenBySavedKey<T extends { provider: string; key_ref: string; model: string }>(rows: T[], keyOrder: string[]): T[] {
  const rank = new Map(keyOrder.map((id, i) => [id, i]));
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.key_ref) ?? [];
    group.push(row);
    groups.set(row.key_ref, group);
  }
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...groups.entries()].sort((a, b) => at(a[0]) - at(b[0])).flatMap(([, group]) => sortRowsAZ(group));
}

/** Text of a chat reply: plain string, a list of text parts, or (for thinking models) the reasoning text. */
export function replyText(msg: any): string {
  const c = msg?.content;
  if (typeof c === "string" && c.trim()) return c;
  if (Array.isArray(c)) {
    const joined = c.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
    if (joined.trim()) return joined;
  }
  for (const k of ["reasoning_content", "reasoning"]) if (typeof msg?.[k] === "string" && msg[k].trim()) return msg[k];
  return "";
}

/** A test call works when the provider answered 200 with a reply choice, even if a thinking model used its whole budget and wrote no visible text. */
export function testReplyWorks(json: any): boolean {
  const choice = json?.choices?.[0];
  return !!choice && (choice.message != null || choice.delta != null || typeof choice.text === "string" || choice.finish_reason != null);
}

/** Request bodies to try for a test: some models reject max_tokens and want max_completion_tokens, some want neither. */
export function testBodies(model: string) {
  const messages = [{ role: "user", content: "Reply with the single word OK." }];
  return [
    { model, messages, stream: false, max_tokens: 256 },
    { model, messages, stream: false, max_completion_tokens: 256 },
    { model, messages, stream: false },
  ];
}

/** A 400/422 about request settings (not about the model itself): try the next body instead of failing. */
export function isSettingsComplaint(status: number, text: string): boolean {
  return (status === 400 || status === 422) && /max_tokens|max_completion_tokens|unsupported (parameter|value)|not supported with this model|temperature|stream/i.test(text) && !/model.{0,40}(not found|does not exist|unknown|invalid)/i.test(text);
}

/** Owner-facing result of a failed test, telling a busy key apart from a broken model. */
export function testFailureMessage(status: number, text: string): string {
  if (status === 401 || status === 403) return "The key was rejected. Check this key in AI Models.";
  if (status === 429) return "This key is busy or at its limit right now. The model may still work: try again in a minute.";
  if (status === 402 || /credit|quota|billing|insufficient/i.test(text)) return "No credit or quota left on this key. Choose another model.";
  if (status === 404 || /model.{0,40}(not found|does not exist|unknown|invalid)|no such model/i.test(text)) return "This model is not available on this key. Choose another model.";
  if (status >= 500) return `The provider had a problem (${status}). Try again in a minute.`;
  return `The provider answered ${status}. Choose another model.`;
}

/** One row in the side chat's right-hand Models panel. */
export type PanelModel = { id: string; source: "chosen" | "ollama"; groupId: string; groupLabel: string; model: string; keyId?: string };
export type ChatEngine = "openrouter" | "ollama" | "chosen";

/**
 * Which models the right-hand panel lists: only the mode in charge.
 * Chosen models mode lists saved chosen models (never Ollama activated ones);
 * Ollama mode lists activated Ollama models (never chosen ones); OpenRouter lists none.
 */
export function panelModelsFor(
  engine: ChatEngine | null | undefined,
  chosen: Array<{ id: string; key_ref: string; key_label: string; model: string }>,
  ollamaKeys: Array<{ id: string; label: string; active: boolean; active_model: string | null }>,
): PanelModel[] {
  if (engine === "chosen") return chosen.map((r) => ({ id: r.id, source: "chosen", groupId: r.key_ref, groupLabel: r.key_label, model: r.model }));
  if (engine === "ollama") return ollamaKeys.filter((k) => k.active && k.active_model).map((k) => ({ id: `${k.id}|${k.active_model}`, source: "ollama", groupId: k.id, groupLabel: k.label, model: k.active_model as string, keyId: k.id }));
  return [];
}

/** True when this panel row is the model the chat is using now. */
export function isCurrentPanelModel(row: PanelModel, chat: { chosenModelId: string | null; keyId: string | null; model: string | null }): boolean {
  return row.source === "chosen" ? row.id === chat.chosenModelId : row.keyId === chat.keyId && row.model === chat.model;
}
