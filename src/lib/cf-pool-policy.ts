// Pure rules for the Cloudflare key pool. No network, no database — the chat
// loop calls these and tests cover them with mocked inputs.

export const POOL_MAX_KEYS = 60;
export const HANDOFF_AT = 9_000;
export const PREFLIGHT_MAX = 9_500;
export const SAME_KEY_RETRIES = 3;
export const RETRY_DELAY_MS = 60_000;
export const MAX_REPAIRS = 3;

/* ---------- order ---------- */

/** Strict pool order 1 → 60. Nothing is skipped or filtered by internal flags. */
export function orderPool<T extends { position: number }>(keys: T[]): T[] {
  return [...keys].sort((a, b) => a.position - b.position).slice(0, POOL_MAX_KEYS);
}

/** Next key after `position`, or null at the end of the line (key 60). */
export function nextKey<T extends { position: number }>(ordered: T[], position: number): T | null {
  return ordered.find((k) => k.position > position) ?? null;
}

/* ---------- errors ---------- */

const DAILY_QUOTA_RE =
  /daily (free )?(allocation|allowance|neuron)|used up your daily|exceeded your daily|\b4006\b|neurons? (limit|quota) (reached|exceeded)/i;

export type ErrorKind = "quota" | "rate_limit" | "other";

/** Only a confirmed daily-allocation message counts as quota. A bare 429 is a rate limit. */
export function classifyError(status: number | null, body: string): ErrorKind {
  if (DAILY_QUOTA_RE.test(body)) return "quota";
  if (status === 429 || /\b429\b|too many requests|rate.?limit/i.test(body)) return "rate_limit";
  return "other";
}

export type RetryDecision = { action: "retry"; delayMs: number; attempt: number } | { action: "pause" };

/** Rate-limited keys retry the same key 3 times, 60 s apart, then pause for the admin. */
export function retryDecision(retriesSoFar: number): RetryDecision {
  if (retriesSoFar < SAME_KEY_RETRIES) return { action: "retry", delayMs: RETRY_DELAY_MS, attempt: retriesSoFar + 1 };
  return { action: "pause" };
}

/** What to do after a key error: quota → next key, rate limit → retry/pause, other → pause. */
export function onKeyError(kind: ErrorKind, retriesSoFar: number): RetryDecision | { action: "next_key" } {
  if (kind === "quota") return { action: "next_key" };
  if (kind === "rate_limit") return retryDecision(retriesSoFar);
  return { action: "pause" };
}

/* ---------- budget ---------- */

export const shouldHandOffAt = (keyTotal: number) => keyTotal >= HANDOFF_AT;

/** Blocks a call whose worst-case cost would push the key past 9,500. */
export function preflightAllowed(keyTotal: number, estimatedCallCost: number): boolean {
  return keyTotal + Math.max(0, estimatedCallCost) <= PREFLIGHT_MAX;
}

/* ---------- per-run cap ---------- */

export type CapCheck = { ok: true; cap: number | null } | { ok: false; error: string };

/** Off = no cap. On = a positive number, never more than today's remaining amount when known. */
export function validateRunCap(enabled: boolean, cap: number | null | undefined, todayRemaining: number | null): CapCheck {
  if (!enabled) return { ok: true, cap: null };
  const n = Number(cap);
  if (!cap || !Number.isFinite(n) || n <= 0) return { ok: false, error: "Enter a Neuron cap above 0 for this run." };
  if (todayRemaining != null && n > todayRemaining)
    return { ok: false, error: `The cap (${n.toLocaleString()}) is more than today's remaining ${todayRemaining.toLocaleString()} Neurons.` };
  return { ok: true, cap: Math.floor(n) };
}

export type StopReason = "cap" | "toggle_off" | "stopped" | "done" | "last_key" | null;

export function runStopReason(s: {
  runUsed: number;
  cap: number | null;
  poolEnabled: boolean;
  userStopped: boolean;
  taskDone: boolean;
  atLastKey: boolean;
}): StopReason {
  if (s.userStopped) return "stopped";
  if (s.taskDone) return "done";
  if (!s.poolEnabled) return "toggle_off";
  if (s.cap != null && s.runUsed >= s.cap) return "cap";
  if (s.atLastKey) return "last_key";
  return null;
}

/* ---------- counting ---------- */

/** Neurons per million tokens, from Cloudflare's Workers AI pricing page. */
export const CF_RATES: Record<string, { in: number; out: number }> = {
  "@cf/qwen/qwen2.5-coder-32b-instruct": { in: 60_000, out: 90_909 },
  "@cf/qwen/qwq-32b": { in: 60_000, out: 90_909 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { in: 4_625, out: 30_475 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { in: 26_668, out: 204_805 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { in: 4_119, out: 34_868 },
  "@cf/meta/llama-3.2-11b-vision-instruct": { in: 4_410, out: 61_493 },
};
/** Unknown models use the highest listed rate so we never under-count. */
export const FALLBACK_RATE = { in: 60_000, out: 204_805 };
export const rateFor = (model: string) => CF_RATES[model] ?? FALLBACK_RATE;

export type CountSource = "cloudflare" | "estimate" | "uncertain";
export type Count = { neurons: number; source: CountSource };

/**
 * Cloudflare's own number wins. Otherwise tokens × per-model rate ("estimate").
 * Without token counts, ~3 chars per token priced at the output rate ("uncertain").
 * Failed calls that used tokens are counted the same way.
 */
export function countCall(a: {
  model: string;
  real?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  chars?: number;
}): Count {
  if (a.real != null && Number.isFinite(a.real)) return { neurons: Math.round(a.real), source: "cloudflare" };
  const r = rateFor(a.model);
  if (a.inputTokens != null || a.outputTokens != null)
    return { neurons: Math.ceil(((a.inputTokens ?? 0) * r.in + (a.outputTokens ?? 0) * r.out) / 1_000_000), source: "estimate" };
  const tokens = Math.ceil((a.chars ?? 0) / 3);
  return { neurons: Math.ceil((tokens * Math.max(r.in, r.out)) / 1_000_000), source: "uncertain" };
}

/** Day bucket for totals: resets at 00:00 UTC (01:00 Lagos). */
export const utcDayOf = (d: Date) => d.toISOString().slice(0, 10);

export const lagosTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "medium" }).format(d) + " WAT";

/* ---------- ledger + handoff ---------- */

export type LedgerEntry = {
  key: number;
  filesDone: string[];
  neuronsThisTurn: number;
  totalAtHandoff: number;
  remaining: number;
  source: CountSource;
  asOf: string;
  reason: string;
  successor: number | null;
  retries: number;
  lagos: string;
};

export function ledgerEntry(e: Omit<LedgerEntry, "remaining" | "lagos" | "asOf"> & { at?: Date }): LedgerEntry {
  const at = e.at ?? new Date();
  const { at: _a, ...rest } = e;
  return { ...rest, remaining: Math.max(0, HANDOFF_AT - e.totalAtHandoff), asOf: at.toISOString(), lagos: lagosTime(at) };
}

export function handoffNote(n: { completed: string[]; remaining: string; lastError: string | null; next: string; position: number; of?: number }) {
  return [
    `Handoff — you are key #${n.position} of ${n.of ?? POOL_MAX_KEYS}. Same job, same agent.`,
    `Completed files (saved, valid, showing in preview — do not rewrite): ${n.completed.join(", ") || "none"}`,
    `Remaining work: ${n.remaining || "finish the original request"}`,
    `Last error: ${n.lastError ?? "none"}`,
    `Next action: ${n.next}`,
    `Hand off at ${HANDOFF_AT.toLocaleString()} Neurons; never exceed ${PREFLIGHT_MAX.toLocaleString()}.`,
  ].join("\n");
}

/* ---------- saves ---------- */

/** A file is only saved when it is complete and valid. */
export function validateFile(path: string, content: string): { ok: true } | { ok: false; error: string } {
  if (!content.trim()) return { ok: false, error: "Empty file" };
  if (/\.\.\.\s*(rest of|existing|keep|remaining).*$/im.test(content) || /\/\/\s*\.\.\.\s*$/m.test(content))
    return { ok: false, error: "File looks partial (placeholder like '... rest of code')" };
  if (/\.json$/i.test(path)) {
    try {
      JSON.parse(content);
    } catch {
      return { ok: false, error: "Invalid JSON" };
    }
    return { ok: true };
  }
  if (/\.(tsx?|jsx?|css|mjs|cjs)$/i.test(path)) {
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
      .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, "''");
    for (const [o, c] of [["{", "}"], ["(", ")"], ["[", "]"]] as const) {
      const opens = stripped.split(o).length - 1;
      const closes = stripped.split(c).length - 1;
      if (opens !== closes) return { ok: false, error: `Unbalanced ${o}${c} — the file looks cut off` };
    }
  }
  return { ok: true };
}

/** Up to 3 repair attempts after a failed save or preview check, then pause with a note. */
export const repairDecision = (failures: number): "repair" | "pause" => (failures <= MAX_REPAIRS ? "repair" : "pause");
