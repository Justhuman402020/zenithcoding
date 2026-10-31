import { createTwoFilesPatch } from "diff";
import { redactSecrets } from "./browser-check-policy";

export type WorkStep = { time: string; text: string; status?: string; detail?: string; durationMs?: number | null };
export type FileEvidence = { path: string; kind: "added" | "edited" | "deleted"; patch?: string; unavailable?: string };
export function safeLogText(text: string): string {
  return redactSecrets(text)
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[hidden]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[hidden]")
    .replace(/((?:[\w.-]*(?:password|secret|token|api[_-]?key)[\w.-]*)\s*=\s*)([^\s"'`;]+)/gi, "$1[hidden]")
    .replace(/((?:[\w.-]*(?:password|secret|token|api[_-]?key)[\w.-]*)["']?\s*[:=]\s*)(["'])(.*?)\2/gi, "$1$2[hidden]$2")
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g, "[hidden private key]");
}
export function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[omitted]";
  if (typeof value === "string") return safeLogText(value).slice(0, 24000);
  if (Array.isArray(value)) return value.slice(0, 40).map(v => sanitizeDetail(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, /password|secret|token|authorization|api.?key|key_encrypted/i.test(k) ? "[hidden]" : sanitizeDetail(v, depth + 1)]));
  return value;
}
export function fileEvidence(path: string, before: string | null | undefined, after: string | null): FileEvidence {
  const kind = after === null ? "deleted" : before === null ? "added" : "edited";
  if (/(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12)|credentials(?:\..*)?)$/i.test(path)) return { path, kind, unavailable: "Private file contents hidden." };
  if (before === undefined) return { path, kind, unavailable: "Previous version was not available." };
  if ((before?.length ?? 0) + (after?.length ?? 0) > 120000 || before?.startsWith("data:") || after?.startsWith("data:")) return { path, kind, unavailable: "Difference unavailable for large or media files." };
  const patch = createTwoFilesPatch(path, path, safeLogText(before ?? ""), safeLogText(after ?? ""), "Before", "After", { context: 3 });
  return patch.length > 24000 ? { path, kind, unavailable: "Difference too large to display." } : { path, kind, patch };
}
export function parseWorkLog(log: string) {
  const [stepsPart, filesPart = ""] = log.split(/\n\nFiles changed:\n/);
  const steps: WorkStep[] = stepsPart.split("\n").map(l => l.replace(/^- /, "").trim()).filter(Boolean).filter(l => !l.startsWith("<!-- run:")) .map(l => {
    const m = l.match(/^(\d\d:\d\d:\d\d) UTC · (.*)$/);
    return m ? { time: m[1], text: safeLogText(m[2]) } : { time: "", text: safeLogText(l) };
  });
  const files = filesPart.split("\n").map(l => l.replace(/^- `?|`$/g, "").trim()).filter(Boolean);
  return { steps, files };
}
export function workedFor(steps: WorkStep[]) {
  const times = steps.filter(s => s.time).map(s => s.time.split(":").map(Number).reduce((n, v) => n * 60 + v, 0));
  if (times.length < 2) return null;
  let seconds = times[times.length - 1] - times[0];
  if (seconds < 0) seconds += 86400;
  return durationLabel(seconds * 1000);
}
export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
export function messageRunId(text: string, messageId: string) {
  return text.match(/<!-- run:([\w-]+) -->/)?.[1] ? `j-${text.match(/<!-- run:([\w-]+) -->/)?.[1]}` : `m-${messageId}`;
}
export function rememberChatScroll(projectId: string, chatId?: string) {
  const el = document.querySelector('[data-work-chat-scroll]');
  if (el) sessionStorage.setItem(`work-scroll:${chatId ?? projectId}`, String(el.scrollTop));
}