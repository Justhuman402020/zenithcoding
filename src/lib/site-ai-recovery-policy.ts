import { classifyError } from "./cf-pool-policy";

export const SITE_KEY_RETRIES = 4;
export function siteRetryDecision(status: number, body: string, attempts: number, retryAfterSeconds = 0) {
  if ([400, 401, 402, 403, 404, 422].includes(status)) return { outcome: "denied", delay: 0 };
  if (classifyError(status, body) === "quota") return { outcome: "quota", delay: 1 };
  if (status === 429 || status === 503) return attempts <= SITE_KEY_RETRIES
    ? { outcome: "retry", delay: Math.max(retryAfterSeconds, 60 * 2 ** (attempts - 1)) }
    : { outcome: "next", delay: Math.max(retryAfterSeconds, 60) };
  // Ambiguous failures can already have consumed inference. Never blindly replay them.
  return { outcome: "uncertain", delay: 0 };
}
export function safeSiteProviderUrl(value: string) {
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "api.cloudflare.com" && !u.username && !u.password && /^\/client\/v4\/accounts\/[a-zA-Z0-9]+\/ai\/v1\/?$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; }
}
export function eligibleSiteKeys<T extends { position: number; used: number; status: string }>(keys: T[], minimum: number) {
  return keys.filter(k => k.position >= minimum && k.used < 9000 && k.status !== "exhausted").sort((a,b) => a.position-b.position).slice(0,60);
}