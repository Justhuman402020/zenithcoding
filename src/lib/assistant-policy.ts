// Pure rules for the Code Haven chat helper. No network calls here.

/** Block Cloudflare inference, not Ollama servers hosted behind Cloudflare tunnels. */
export function isCloudflareUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    return host === "cloudflare.com" || host.endsWith(".cloudflare.com")
      || host === "workers.dev" || host.endsWith(".workers.dev")
      || /\/ai\/v1\b/i.test(pathname);
  } catch {
    return /\/ai\/v1\b/i.test(url);
  }
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

/**
 * Builds the chat helper's system message. The attached project goes first so a
 * small character limit (slow self-hosted models) cuts Brain/vault notes, never the project.
 */
export function fitHelperContext(sections: { core: string[]; project: string[]; extra: string[] }, limit: number): string {
  const head = [...sections.core, ...sections.project].join("\n\n");
  const full = [head, ...sections.extra].filter(Boolean).join("\n\n");
  return full.slice(0, Math.max(0, limit));
}

/** Character limits for the chat helper's system message per engine. */
export const HELPER_CONTEXT_LIMIT = { ollama: 9000, openrouter: 60000 } as const;
/** Per-file and total file-content budgets per engine. */
export const HELPER_FILE_BUDGET = { ollama: { perFile: 1500, total: 5000 }, openrouter: { perFile: 4000, total: 24000 } } as const;

/** True for .env-style files whose values must never reach the chat. */
export function isEnvFile(path: string): boolean {
  return /(^|\/)\.env(\.|$)/i.test(path) || /(^|\/)\.dev\.vars$/i.test(path);
}
/** Keeps variable names, hides values. */
export function redactEnv(text: string): string {
  return text.split("\n").map((l) => /^\s*(export\s+)?[A-Za-z_][\w.]*\s*=/.test(l) ? l.replace(/=.*/, "=•••• (hidden)") : l).join("\n");
}

// ---------- Read-only project tools for the chat helper ----------
// The helper can look at everything in the attached project, but it can never edit.
// Changes go to the build model through an approved <edit> request.

export type HelperFile = { path: string; content: string };
export type HelperErrors = { build: string; jobs: string[]; preview: string[] };

/** Every tool the chat helper may call. None of them write anything. */
export const HELPER_TOOL_NAMES = ["list_files", "read_file", "search_files", "project_errors"] as const;
export const HELPER_TOOL_ROUNDS = 6;

export const HELPER_TOOLS = [
  { type: "function", function: { name: "list_files", description: "List every file path in the attached project.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "read_file", description: "Read the full text of one project file.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "search_files", description: "Find lines containing some text across all project files.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "project_errors", description: "Show current build problems, failed recent builds and preview screenshot findings.", parameters: { type: "object", properties: {} } } },
] as const;

const show = (f: HelperFile) => (isEnvFile(f.path) ? redactEnv(f.content) : f.content);

/** Runs one read-only helper tool over already-loaded project data. */
export function runHelperTool(name: string, rawArgs: string, files: HelperFile[], errors: HelperErrors, maxChars = 12000): string {
  let args: any = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { args = {}; }
  if (name === "list_files") return files.length ? files.map((f) => `${f.path} (${f.content.length} chars)`).join("\n") : "The project has no files.";
  if (name === "read_file") {
    const want = String(args.path ?? "").replace(/^\.?\/+/, "");
    const f = files.find((x) => x.path === want) ?? files.find((x) => x.path.toLowerCase() === want.toLowerCase()) ?? files.find((x) => x.path.endsWith(`/${want}`));
    if (!f) return `No file "${want}". Files: ${files.map((x) => x.path).slice(0, 80).join(", ")}`;
    const body = show(f);
    return `--- ${f.path}\n${body.slice(0, maxChars)}${body.length > maxChars ? `\n…(${body.length - maxChars} more chars cut)` : ""}`;
  }
  if (name === "search_files") {
    const q = String(args.query ?? "").toLowerCase();
    if (!q) return "Give some text to search for.";
    const hits: string[] = [];
    for (const f of files) {
      show(f).split("\n").forEach((line, i) => { if (hits.length < 60 && line.toLowerCase().includes(q)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 200)}`); });
    }
    return hits.length ? hits.join("\n") : `No lines contain "${args.query}".`;
  }
  if (name === "project_errors") return formatHelperErrors(errors);
  return `Unknown tool "${name}". You can only read: ${HELPER_TOOL_NAMES.join(", ")}. You cannot edit; put changes in <edit>…</edit> for the build model.`;
}

export function formatHelperErrors(e: HelperErrors): string {
  return [
    `Build check: ${e.build}`,
    `Recent failed builds: ${e.jobs.length ? e.jobs.join(" | ") : "none"}`,
    `Latest preview screenshot findings: ${e.preview.length ? e.preview.join(" | ") : "none recorded"}`,
  ].join("\n");
}
