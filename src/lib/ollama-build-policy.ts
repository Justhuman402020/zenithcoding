/** Pure rules for picking which turned-on Ollama key/model a build uses. */
export type OllamaKeyRow = { id: string; label: string | null; created_at: string; activated_at: string | null; active_model: string | null };

/** The key you turned on most recently goes first; older turned-on keys follow as backups. */
export function orderOllamaBuildKeys<T extends OllamaKeyRow>(rows: T[]): T[] {
  const t = (r: OllamaKeyRow) => Date.parse(r.activated_at ?? r.created_at) || 0;
  return rows.filter((r) => !!r.active_model).sort((a, b) => t(b) - t(a));
}

/** Ollama lists installed models by exact name; ":latest" is implied when no tag is given. */
export function modelInstalled(model: string, installed: string[]): boolean {
  const norm = (m: string) => (m.includes(":") ? m : `${m}:latest`).toLowerCase();
  const want = norm(model);
  return installed.some((m) => norm(m) === want);
}
