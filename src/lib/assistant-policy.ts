// Pure rules for the Code Haven chat helper. No network calls here.

/** The chat helper may never talk to Cloudflare. */
export function isCloudflareUrl(url: string): boolean {
  return /cloudflare\.com|workers\.dev|\/ai\/v1\b/i.test(url);
}

export function assertChatUrlAllowed(url: string): void {
  if (isCloudflareUrl(url)) throw new Error("The chat helper can't use Cloudflare. Edits go through Cloudflare only after you tap Yes.");
}

/** Everything the chat helper can do. Reading only — no write/delete. */
export const ASSISTANT_CAPABILITIES = ["read_projects", "read_files", "read_brain", "read_vault_names", "read_recent_jobs", "propose_edit"] as const;

/** Pulls an edit proposal out of the model reply: <edit>...</edit>. */
export function parseEditProposal(reply: string): { text: string; edit: string | null } {
  const m = /<edit>([\s\S]*?)<\/edit>/i.exec(reply);
  if (!m) return { text: reply.trim(), edit: null };
  const edit = m[1]!.trim();
  return { text: reply.replace(m[0], "").trim(), edit: edit || null };
}

export type EditStatus = "pending" | "approved" | "declined" | "running" | "done" | "failed";

/** A build may start only after you approve. */
export function canStartBuild(status: EditStatus): boolean {
  return status === "approved";
}

export function decide(status: EditStatus, answer: "yes" | "no"): EditStatus {
  if (status !== "pending") return status;
  return answer === "yes" ? "approved" : "declined";
}

/** Ollama's OpenAI-compatible base. */
export function ollamaBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/(v1|api)$/, "");
}
