// Opens a site in Cloudflare Browser Rendering (a real Chrome) and reports what a visitor sees.
import { cleanFindings, injectReporter, PREVIEW_TOKEN_TTL_MS, REPORTER_SCRIPT, redactSecrets, type CheckShot, type Findings } from "./browser-check-policy";

type Account = { id: string; label: string; account: string; token: string };

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const hashToken = sha256;

async function poolAccounts(): Promise<Account[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { isCloudflareBaseUrl } = await import("./cloudflare-pool.server");
  const { data } = await supabaseAdmin
    .from("custom_ai_providers")
    .select("id, label, base_url, created_at, pool_position, key_encrypted" as any)
    .order("created_at", { ascending: true });
  const rows = ((data ?? []) as any[])
    .filter((r) => isCloudflareBaseUrl(r.base_url) && r.key_encrypted)
    .sort((a, b) => (a.pool_position ?? 999) - (b.pool_position ?? 999));
  const out: Account[] = [];
  for (const r of rows) {
    const account = /accounts\/([^/]+)\//i.exec(r.base_url)?.[1];
    if (!account) continue;
    try {
      out.push({ id: r.id, label: r.label, account, token: (await decryptSecret(r.key_encrypted)).replace(/^Bearer\s+/i, "").trim() });
    } catch { /* skip unreadable key */ }
  }
  return out;
}

export async function createPreviewToken(userId: string, projectId: string, html: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const raw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await supabaseAdmin.from("preview_tokens" as any).delete().lt("expires_at", new Date().toISOString());
  const { error } = await supabaseAdmin.from("preview_tokens" as any).insert({
    token_hash: await sha256(raw), user_id: userId, project_id: projectId,
    html: injectReporter(html), expires_at: new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString(),
  } as any);
  if (error) throw new Error("Could not prepare the test address");
  return raw;
}

export async function createSourcePreviewToken(userId: string, projectId: string, files: Array<{ path: string; content: string }>) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const raw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { error } = await db.from("preview_tokens").insert({ token_hash: await sha256(raw), user_id: userId, project_id: projectId, html: JSON.stringify({ files }), expires_at: new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString() });
  if (error) throw new Error("Could not prepare private source preview");
  return raw;
}

class PermissionError extends Error {}
class RateLimitError extends Error {}

async function cf(acct: Account, endpoint: "screenshot" | "scrape", body: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct.account}/browser-rendering/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acct.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) throw new PermissionError("Cloudflare needs Account → Browser Rendering → Edit on this account; check the token's account access.");
  if (res.status === 429) throw new RateLimitError("Cloudflare screenshot limit reached on this account.");
  if (!res.ok) throw new Error(`Browser test failed (${res.status}): ${redactSecrets((await res.text()).slice(0, 200))}`);
  return res;
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const common = (url: string, published: boolean) => ({
  url,
  gotoOptions: { waitUntil: "networkidle0", timeout: 30_000 },
  waitForTimeout: 2500,
  ...(published ? { addScriptTag: [{ content: REPORTER_SCRIPT + ";window.__chReport&&window.__chReport()" }] } : {}),
});

export type CheckOutcome =
  | { ok: true; findings: Findings; shots: CheckShot[]; accountLabel: string; durationMs: number; missingPermission: string[] }
  | { ok: false; error: string; missingPermission: string[]; durationMs: number };

export async function runCheck(opts: { userId: string; projectId: string; url: string; published: boolean }): Promise<CheckOutcome> {
  const started = Date.now();
  if (["localhost", "127.0.0.1", "::1"].includes(new URL(opts.url).hostname)) return { ok: false, error: "The remote screenshot browser cannot open the local editor address. Publish this update, then run the screenshot check from your live Code Haven site.", missingPermission: [], durationMs: 0 };
  const accounts = await poolAccounts();
  const missing: string[] = [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let rateLimited = !accounts.length;
  for (const acct of accounts) {
    try {
      const sep = opts.url.includes("?") ? "&" : "?";
      const shotsSpec = [
        { label: "Phone", url: opts.url, viewport: PHONE },
        { label: "Phone, scrolled", url: `${opts.url}${sep}__scroll=2200`, viewport: PHONE },
        { label: "Desktop", url: opts.url, viewport: DESKTOP },
      ];
      const shots: CheckShot[] = [];
      for (const s of shotsSpec) {
        const body: any = { ...common(s.url, opts.published), viewport: s.viewport, screenshotOptions: { type: "jpeg", quality: 60 } };
        if (opts.published && s.label.includes("scrolled")) body.addScriptTag = [...(body.addScriptTag ?? []), { content: "scrollTo(0,2200)" }];
        const res = await cf(acct, "screenshot", body);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const path = `${opts.userId}/${opts.projectId}/${Date.now()}-${shots.length}.jpg`;
        const { error: uploadError } = await supabaseAdmin.storage.from("browser-checks").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw new Error("Could not save the private screenshot.");
        shots.push({ label: s.label, url: path });
      }
      const scrape = await cf(acct, "scrape", { ...common(opts.url, opts.published), viewport: PHONE, elements: [{ selector: "#__ch_report" }] });
      const j: any = await scrape.json().catch(() => null);
      const text = j?.result?.[0]?.results?.[0]?.text ?? "";
      let parsed: unknown = {};
      try { parsed = JSON.parse(text); } catch { parsed = { pageErrors: text ? [] : ["The page did not finish loading in the test browser."] }; }
      return { ok: true, findings: cleanFindings(parsed), shots, accountLabel: acct.label, durationMs: Date.now() - started, missingPermission: missing };
    } catch (e) {
    if (e instanceof PermissionError) { missing.push(acct.label); continue; }
      if (e instanceof RateLimitError) { rateLimited = true; continue; }
      return { ok: false, error: e instanceof Error ? e.message : "Browser test failed", missingPermission: missing, durationMs: Date.now() - started };
    }
  }
  if (rateLimited) {
    const backup = await runBackupBrowser(opts, started, missing).catch((e) => ({ ok: false as const, error: `Backup browser failed: ${e instanceof Error ? redactSecrets(e.message) : "unknown error"}`, missingPermission: missing, durationMs: Date.now() - started }));
    return backup;
  }
  return { ok: false, error: "Browser capture needs Account → Browser Rendering → Edit, with access to the selected Cloudflare account.", missingPermission: missing, durationMs: Date.now() - started };
}

// Backup browser (Microlink): used only when every Cloudflare account is rate-limited or none is saved.
// Works without signup (small daily free allowance); MICROLINK_API_KEY raises the allowance.
async function runBackupBrowser(opts: { userId: string; projectId: string; url: string }, started: number, missing: string[]): Promise<CheckOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = process.env.MICROLINK_API_KEY;
  const sep = opts.url.includes("?") ? "&" : "?";
  const specs = [
    { label: "Phone", url: opts.url, viewport: PHONE, mobile: true },
    { label: "Phone, scrolled", url: `${opts.url}${sep}__scroll=2200`, viewport: PHONE, mobile: true },
    { label: "Desktop", url: opts.url, viewport: DESKTOP, mobile: false },
  ];
  const shots: CheckShot[] = [];
  for (const s of specs) {
    const res = await fetch(microlinkScreenshotUrl(s.url, s.viewport, s.mobile, !!key), {
      headers: key ? { "x-api-key": key } : {},
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429) throw new Error("the backup browser's daily free limit is used up too.");
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw new Error(`backup browser returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${opts.userId}/${opts.projectId}/${Date.now()}-${shots.length}.jpg`;
    const { error } = await supabaseAdmin.storage.from("browser-checks").upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error("could not save the private screenshot.");
    shots.push({ label: s.label, url: path });
  }
  return { ok: true, findings: cleanFindings({}), shots, accountLabel: "Backup browser (Microlink)", durationMs: Date.now() - started, missingPermission: missing };
}

export function microlinkScreenshotUrl(url: string, vp: { width: number; height: number }, mobile: boolean, pro: boolean) {
  const q = new URLSearchParams({
    url, screenshot: "true", meta: "false", embed: "screenshot.url", type: "jpeg",
    "viewport.width": String(vp.width), "viewport.height": String(vp.height),
    "viewport.isMobile": String(mobile), waitForTimeout: "2500", waitUntil: "networkidle0", force: "true",
  });
  return `https://${pro ? "pro" : "api"}.microlink.io/?${q}`;
}
