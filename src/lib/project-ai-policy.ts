// Pure rules for "Use Cloudflare for this project" (site AI chat through the owner's pool).

export const SITE_CHAT_DAILY_CAP = 500;
export const MAX_SITE_MESSAGES = 30;
export const MAX_SITE_CHARS = 24_000;
export const AI_URL_KEY = "VITE_CODE_HAVEN_AI_URL";
export const AI_TOKEN_KEY = "VITE_CODE_HAVEN_AI_TOKEN";

export type ProjectAiStatus = "off" | "setting_up" | "on" | "needs_fix";

/** Turning on requires the Cloudflare pool switch; turning off is always allowed. */
export function canEnable(poolEnabled: boolean): { ok: true } | { ok: false; reason: string } {
  return poolEnabled ? { ok: true } : { ok: false, reason: "Your Cloudflare pool is off. Turn it on in Admin → AI Models first." };
}

/** Decides whether a site chat request may run right now. */
export function siteChatDecision(s: { enabled: boolean; poolEnabled: boolean; dayRequests: number; cap?: number }) {
  if (!s.enabled) return { ok: false as const, status: 403, error: "AI is off for this site." };
  if (!s.poolEnabled) return { ok: false as const, status: 503, error: "AI is paused right now." };
  if (s.dayRequests >= (s.cap ?? SITE_CHAT_DAILY_CAP)) return { ok: false as const, status: 429, error: "Daily AI limit reached. Try again tomorrow." };
  return { ok: true as const };
}

/** Requests counted for today; resets when the UTC day changes. */
export function nextDayCount(prevDay: string | null, prevCount: number, today: string) {
  return prevDay === today ? prevCount + 1 : 1;
}

type Msg = { role: string; content: unknown };
/** Keeps only safe text messages within size limits; returns null if nothing usable. */
export function cleanMessages(input: unknown): Array<{ role: "system" | "user" | "assistant"; content: string }> | null {
  if (!Array.isArray(input)) return null;
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  for (const m of input.slice(-MAX_SITE_MESSAGES) as Msg[]) {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim()) continue;
    out.push({ role: m.role as "system" | "user" | "assistant", content: m.content });
  }
  let total = out.reduce((t, m) => t + m.content.length, 0);
  while (total > MAX_SITE_CHARS && out.length > 1) { const removed=out.shift();if(removed)total-=removed.content.length; }
  if (!out.length || total > MAX_SITE_CHARS) return null;
  return out.some((m) => m.role === "user") ? out : null;
}

/** Which model a site chat uses: the project's pick, else the owner's selected Cloudflare model. */
export function pickSiteChatModel(projectModel: string | null | undefined, fallbackModel: string) {
  const pick = (projectModel ?? "").trim();
  return pick && pick.length <= 120 ? pick : fallbackModel;
}

export function rewirePrompt() {
  return [
    "Switch this project's AI chat to Cloudflare through Code Haven.",
    `Use import.meta.env.${AI_URL_KEY} and import.meta.env.${AI_TOKEN_KEY} (both already saved for this project).`,
    "Send POST to that URL with headers { 'content-type': 'application/json', authorization: 'Bearer ' + token } and body { messages: [{ role, content }], stream: true }.",
    "The reply is an OpenAI-style server-sent event stream (data: {choices:[{delta:{content}}]} … data: [DONE]); with stream:false it is JSON { reply }.",
    "Generate a stable request_id for each user message and keep it on reconnect. Reuse the same request_id and identical messages to read the saved reply without generating twice. Handle terminal SSE error frames and keep partial text. The x-request-id header identifies the saved request; retry status arrives as SSE comments.",
    "Find the existing AI chat code and replace its provider call with this; keep the UI, routing and other files as they are. Never put any other API key in the code.",
    "If the project has no AI chat yet, add a simple chat panel that uses it. Show 'AI is off' if the response status is 403.",
  ].join("\n");
}
