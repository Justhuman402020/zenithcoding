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
