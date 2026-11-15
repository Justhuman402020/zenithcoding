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

/** Keep keys in their saved order and names; sort only the models inside each key. */
export function orderChosenBySavedKey<T extends { provider: string; key_ref: string; key_label: string; model: string }>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = `${row.provider}\u0000${row.key_ref}`;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return [...groups.values()].flatMap((group) => sortRowsAZ(group));
}
