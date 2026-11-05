// Microlink captures real browser screenshots; OpenRouter inspects the saved images.
import { cleanFindings, injectReporter, PREVIEW_TOKEN_TTL_MS, type CheckShot, type Findings } from "./browser-check-policy";
import { isScreenshotKey, nextScreenshotKey } from "./screenshot-key-policy";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const hashToken = sha256;

async function screenshotKeys(): Promise<Array<{ label: string; key: string }>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { data, error } = await supabaseAdmin
    .from("admin_credentials")
    .select("id, label, base_url, key_encrypted")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Could not load screenshot keys from Admin Brain.");
  const rows = (data ?? []).filter(isScreenshotKey);
  const out: Array<{ label: string; key: string }> = [];
  for (const r of rows) {
    try {
      out.push({ label: r.label, key: await decryptSecret(r.key_encrypted) });
    } catch { /* skip unreadable key */ }
  }
  if (rows.length && !out.length) throw new Error("Saved screenshot keys could not be unlocked. Replace a key in Admin Brain.");
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

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

export type CheckOutcome =
  | { ok: true; findings: Findings; shots: CheckShot[]; accountLabel: string; durationMs: number; missingPermission: string[] }
  | { ok: false; error: string; missingPermission: string[]; durationMs: number };

export async function runCheck(opts: { userId: string; projectId: string; url: string; published: boolean }): Promise<CheckOutcome> {
  const started = Date.now();
  if (["localhost", "127.0.0.1", "::1"].includes(new URL(opts.url).hostname)) return { ok: false, error: "The remote screenshot browser cannot open the local editor address. Publish this update, then run the screenshot check from your live Code Haven site.", missingPermission: [], durationMs: 0 };
  try { return await runMicrolinkBrowser(opts, started); }
  catch { return { ok: false, error: "Microlink capture could not finish. Check your saved screenshot keys in Admin Brain and try again.", missingPermission: [], durationMs: Date.now() - started }; }
}

async function runMicrolinkBrowser(opts: { userId: string; projectId: string; url: string }, started: number): Promise<CheckOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const saved = await screenshotKeys();
  const fallback = process.env.MICROLINK_API_KEY;
  const keys = saved.length ? saved : [{ label: fallback ? "Microlink project key" : "Microlink free", key: fallback ?? "" }];
  let keyIndex = 0;
  const sep = opts.url.includes("?") ? "&" : "?";
  const specs = [
    { label: "Phone", url: opts.url, viewport: PHONE, mobile: true },
    { label: "Phone, full page", url: `${opts.url}${sep}__scroll=0`, viewport: PHONE, mobile: true },
    { label: "Desktop", url: opts.url, viewport: DESKTOP, mobile: false },
  ];
  const shots: CheckShot[] = [];
  for (const s of specs) {
    let res: Response | undefined;
    while (keyIndex < keys.length) {
      const selected = keys[keyIndex];
      res = await fetch(microlinkScreenshotUrl(s.url, s.viewport, s.mobile, !!selected.key, s.label.includes("full page")), {
        headers: selected.key ? { "x-api-key": selected.key } : {},
        signal: AbortSignal.timeout(60_000),
      });
      if (!nextScreenshotKey(res.status)) break;
      keyIndex++;
    }
    if (!res || keyIndex >= keys.length) return { ok: false, error: "All Microlink screenshot keys are exhausted or refused. Add or replace a screenshot key in Admin Brain.", missingPermission: [], durationMs: Date.now() - started };
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return { ok: false, error: `Microlink did not return a screenshot (${res.status}).`, missingPermission: [], durationMs: Date.now() - started };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${opts.userId}/${opts.projectId}/${Date.now()}-${shots.length}.jpg`;
    const { error } = await supabaseAdmin.storage.from("browser-checks").upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error("could not save the private screenshot.");
    shots.push({ label: s.label, url: path });
  }
  return { ok: true, findings: cleanFindings({}), shots, accountLabel: `Microlink · ${keys[keyIndex]?.label ?? "saved key"}`, durationMs: Date.now() - started, missingPermission: [] };
}

export function microlinkScreenshotUrl(url: string, vp: { width: number; height: number }, mobile: boolean, pro: boolean, fullPage = false) {
  const q = new URLSearchParams({
    url, screenshot: "true", meta: "false", embed: "screenshot.url", type: "jpeg",
    "viewport.width": String(vp.width), "viewport.height": String(vp.height),
    "viewport.isMobile": String(mobile), "screenshot.fullPage": String(fullPage), waitForTimeout: "2500", waitUntil: "networkidle0", force: "true",
  });
  return `https://${pro ? "pro" : "api"}.microlink.io/?${q}`;
}
