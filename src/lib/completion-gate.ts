// Pure rules that decide whether a build is really finished. No network calls.

export type ChangedFile = { path: string; content: string | null };

export type GateResult = { ok: true } | { ok: false; reason: string; nudge: string };

/** Tools whose successful result means a file really changed. Reads never count. */
export const CHANGE_TOOLS = new Set(["write_file", "edit_file", "patch_file", "delete_file"]);

/** Paths that a step really changed (only successful write/edit/patch/delete results). */
export function changedPathsFromStep(step: { toolResults?: any[] } | undefined): string[] {
  const out: string[] = [];
  for (const r of step?.toolResults ?? []) {
    const name = String(r?.toolName ?? "");
    if (!CHANGE_TOOLS.has(name)) continue;
    const output = r?.output ?? r?.result;
    if (!output || output.ok !== true) continue;
    const path = output.path ?? r?.input?.path ?? r?.args?.path;
    if (typeof path === "string" && path) out.push(path.replace(/^\.?\/+/, ""));
  }
  return out;
}

/** Local files an HTML page links to (css/js/images) that don't exist in the project. */
export function missingLinks(html: string, allPaths: string[]): string[] {
  const have = new Set(allPaths.map((p) => p.replace(/^\.?\/+/, "")));
  const missing: string[] = [];
  for (const m of html.matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)=["']([^"'#?]+)/gi)) {
    const ref = m[1]!.trim();
    if (!ref || /^(https?:|\/\/|data:|mailto:|tel:|javascript:|\{|\$)/i.test(ref)) continue;
    if (!/\.(css|js|mjs|png|jpe?g|gif|svg|webp)$/i.test(ref)) continue;
    const clean = ref.replace(/^\.?\/+/, "");
    if (!have.has(clean)) missing.push(clean);
  }
  return [...new Set(missing)];
}

/** Reads "Left: ..." from the agent's final checklist. Empty when nothing is left. */
export function leftoverWork(finalText: string): string {
  const m = /^\s*(?:[-*]\s*)?(?:left|remaining|not done)\s*:\s*(.+)$/im.exec(finalText);
  if (!m) return "";
  const v = m[1]!.trim();
  return /^(none|nothing|n\/a|-|—|0)\.?$/i.test(v) ? "" : v;
}

/**
 * The completion gate. A build only counts as finished when:
 *  - a change was asked for and at least one file really changed,
 *  - every changed HTML page only links to files that exist,
 *  - the agent's own checklist doesn't list leftover work.
 */
export function completionGate(input: {
  needsFileChange: boolean;
  changed: ChangedFile[];
  allPaths: string[];
  finalText: string;
}): GateResult {
  if (input.needsFileChange && input.changed.length === 0) {
    return {
      ok: false,
      reason: "No file was changed",
      nudge:
        "Check failed: you were asked to change the project but no file was saved. Do the change now with edit_file (small changes) or write_file (new files), then end with the checklist.",
    };
  }
  for (const f of input.changed) {
    if (f.content == null || !/\.html?$/i.test(f.path)) continue;
    const missing = missingLinks(f.content, input.allPaths);
    if (missing.length) {
      return {
        ok: false,
        reason: `${f.path} links to missing file(s): ${missing.join(", ")}`,
        nudge: `Check failed: ${f.path} links to ${missing.join(", ")} but those files don't exist. Create them or fix the links, then end with the checklist.`,
      };
    }
  }
  const left = leftoverWork(input.finalText);
  if (left) {
    return {
      ok: false,
      reason: `Work left: ${left.slice(0, 200)}`,
      nudge: `You listed work that is not done yet: ${left.slice(0, 400)}. Do it now, then end with the checklist (Left: none).`,
    };
  }
  return { ok: true };
}

/** Max extra rounds the gate can ask for before the build stops with the reason. */
export const MAX_GATE_RETRIES = 2;

/** Removes <think>…</think> blocks some models put inside their visible reply. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
}

/**
 * Shrinks old tool outputs (mostly big read_file results) in carried history so
 * each step sends less text. The newest `keep` messages are left untouched.
 */
export function trimCarried<T>(messages: T[], keep = 4, maxChars = 1500): T[] {
  const cut = Math.max(0, messages.length - keep);
  return messages.map((msg: any, i) => {
    if (i >= cut || msg?.role !== "tool" || !Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map((part: any) => {
        const out = part?.output;
        if (!out) return part;
        const raw = typeof out.value === "string" ? out.value : JSON.stringify(out.value ?? "");
        if (raw.length <= maxChars) return part;
        return { ...part, output: { type: "text", value: `${raw.slice(0, maxChars)}… [older output trimmed — read_file again if needed]` } };
      }),
    };
  }) as T[];
}
