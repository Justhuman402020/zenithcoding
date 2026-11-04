// Pure rules for connecting project domains. Kept free of I/O so they stay unit-testable.

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Clean what the owner typed into a bare hostname, or return null when it isn't a real domain. */
export function normalizeHostname(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  const parts = host.split(".");
  if (parts.length < 2 || !parts.every((p) => LABEL.test(p))) return null;
  // "www.something" with nothing after it is a name missing its ending.
  if (parts[0] === "www" && parts.length < 3) return null;
  // The ending (.com, .xyz, .org…) must be letters, at least 2 of them.
  if (!/^[a-z]{2,63}$/.test(parts[parts.length - 1]!) && !/^xn--[a-z0-9-]+$/.test(parts[parts.length - 1]!)) return null;
  return host;
}

export type DomainStatus = "waiting_records" | "verifying" | "setting_up_ssl" | "live" | "offline" | "failed";

/** Map our TXT check plus Cloudflare's custom-hostname state onto one owner-facing status. */
export function domainStatus(input: { txtOk: boolean; cfStatus?: string | null; sslStatus?: string | null }): DomainStatus {
  const cf = (input.cfStatus ?? "").toLowerCase();
  const ssl = (input.sslStatus ?? "").toLowerCase();
  if (cf === "active" && ssl === "active" && input.txtOk) return "live";
  if (cf.includes("blocked") || cf === "moved" || cf === "deleted" || ssl.includes("timed_out") || ssl === "validation_timed_out") return "failed";
  if (!input.txtOk) return "waiting_records";
  if (cf === "active") return "setting_up_ssl";
  return "verifying";
}

export type DomainSignals = {
  prevStatus: string | null;
  everVerified: boolean;
  txtOk: boolean;
  cfOk: boolean;
  cfStatus?: string | null;
  sslStatus?: string | null;
  siteServes: boolean;
  consecutiveFailures: number;
  firstFailureAt: string | null;
  now: string;
};

const OFFLINE_AFTER_FAILURES = 3;
const OFFLINE_AFTER_MS = 30 * 60_000;

/** Decide the next status; live domains survive single hiccups and only go Offline after repeated failures over time. */
export function nextDomainStatus(s: DomainSignals): { status: DomainStatus; verified: boolean; consecutiveFailures: number; firstFailureAt: string | null } {
  const verified = s.everVerified || s.txtOk;
  const cf = (s.cfStatus ?? "").toLowerCase();
  const ssl = (s.sslStatus ?? "").toLowerCase();
  const cfLive = s.cfOk && cf === "active" && ssl === "active";
  if (s.siteServes || (cfLive && verified)) return { status: "live", verified: true, consecutiveFailures: 0, firstFailureAt: null };

  const wasLive = s.prevStatus === "live" || s.prevStatus === "offline";
  if (wasLive) {
    const fails = s.consecutiveFailures + 1;
    const first = s.firstFailureAt ?? s.now;
    const longEnough = Date.parse(s.now) - Date.parse(first) >= OFFLINE_AFTER_MS;
    const status: DomainStatus = fails >= OFFLINE_AFTER_FAILURES && longEnough ? "offline" : (s.prevStatus as DomainStatus);
    return { status, verified, consecutiveFailures: fails, firstFailureAt: first };
  }

  const base = s.cfOk ? domainStatus({ txtOk: verified, cfStatus: s.cfStatus, sslStatus: s.sslStatus }) : verified ? "verifying" : "waiting_records";
  return { status: base, verified, consecutiveFailures: 0, firstFailureAt: null };
}

export const STATUS_LABEL: Record<DomainStatus, string> = {
  waiting_records: "Waiting for records",
  verifying: "Verifying",
  setting_up_ssl: "Setting up SSL",
  live: "Live",
  offline: "Offline",
  failed: "Needs attention",
};

/** The other half of a root/www pair, used for primary redirects and lookups. */
export function domainPair(host: string): string[] {
  return host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
}

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256(secret, host) — proves a request came through Code Haven's domain forwarder. */
export async function signHost(secret: string, host: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(host.toLowerCase())));
}

export async function verifyHostSignature(secret: string | undefined, host: string, sig: string | null): Promise<boolean> {
  if (!secret || !sig || !host) return false;
  const want = await signHost(secret, host);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** Turn a visitor path like /about.html into the project page to render; null = let the app handle it. */
export function pageForPath(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return "index.html";
  if (pathname === "/forge-sdk.js" || pathname.startsWith("/api/") || pathname.startsWith("/_serverFn") || pathname.startsWith("/assets/")) return null;
  const p = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (p.includes("..")) return "index.html";
  return /\.[a-z0-9]+$/i.test(p) ? p : `${p.replace(/\/$/, "")}.html`;
}

export type ServableDomain = { hostname: string; status: string; project_id: string };

/** Only an exact, non-disconnected hostname may serve a site; a sibling www/root never stands in. */
export function shouldServeDomain(host: string, rows: ServableDomain[]): ServableDomain | null {
  return rows.find((r) => r.hostname === host && r.status !== "disconnected") ?? null;
}

/** What a disconnect does, in order: stop serving first, then clean Cloudflare, then forget the row. */
export function disconnectPlan(records: Array<{ type: string; name: string; value: string }> | null, hostname: string, verifyName = `_forge-verify.${hostname}`) {
  const toDelete = [...(records ?? [])];
  if (!toDelete.some((r) => r.name === verifyName)) toDelete.push({ type: "TXT", name: verifyName, value: "(your verification code)" });
  return { steps: ["mark_disconnected", "remove_custom_hostname", "remove_worker_route", "delete_row"] as const, recordsToDelete: toDelete };
}
