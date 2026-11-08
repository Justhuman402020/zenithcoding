// ScreenshotOne captures real browser screenshots; OpenRouter inspects the saved images.
import { cleanFindings, injectReporter, PREVIEW_TOKEN_TTL_MS, type CheckShot, type Findings } from "./browser-check-policy";
import { ACTIVE_SCREENSHOT_ROW, isScreenshotKey, pickActiveKey, screenshotOneUrl } from "./screenshot-key-policy";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const hashToken = sha256;

/** Only the one ScreenshotOne key the owner turned on in Admin Brain. */
async function activeScreenshotKey(): Promise<{ label: string; key: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const [{ data, error }, { data: active }] = await Promise.all([
    supabaseAdmin.from("admin_credentials").select("id, label, base_url, key_encrypted").order("created_at", { ascending: true }),
    supabaseAdmin.from("admin_brain").select("content").eq("id", ACTIVE_SCREENSHOT_ROW).maybeSingle(),
  ]);
  if (error) throw new Error("Could not load screenshot keys from Admin Brain.");
  const row = pickActiveKey((data ?? []).filter(isScreenshotKey), (active as any)?.content ?? null);
  if (!row) return null;
  try { return { label: row.label, key: await decryptSecret(row.key_encrypted) }; }
  catch { throw new Error("The screenshot key that is on could not be unlocked. Replace it in Admin Brain."); }
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
  try { return await runScreenshotOne(opts, started); }
  catch (e) { return { ok: false, error: `ScreenshotOne capture could not finish: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`, missingPermission: [], durationMs: Date.now() - started }; }
}

async function runScreenshotOne(opts: { userId: string; projectId: string; url: string }, started: number): Promise<CheckOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const selected = await activeScreenshotKey();
  if (!selected) return { ok: false, error: "No screenshot key is turned on. Turn one on in Admin Brain → Screenshot keys.", missingPermission: [], durationMs: Date.now() - started };
  const sep = opts.url.includes("?") ? "&" : "?";
  const specs = [
    { label: "Phone", url: opts.url, viewport: PHONE, mobile: true, full: false },
    { label: "Phone, full page", url: `${opts.url}${sep}__scroll=0`, viewport: PHONE, mobile: true, full: true },
    { label: "Desktop", url: opts.url, viewport: DESKTOP, mobile: false, full: false },
  ];
  const shots: CheckShot[] = [];
  for (const s of specs) {
    let res: Response | null = null; let lastError = "";
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        const r = await fetch(screenshotOneUrl(selected.key, s.url, s.viewport, s.mobile, s.full), { signal: AbortSignal.timeout(110_000) });
        if (r.status >= 500 || r.status === 408) { lastError = `ScreenshotOne ${r.status}: ${(await r.text()).slice(0, 160)}`; continue; }
        res = r;
      } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
    }
    if (!res) return { ok: false, error: `The ${s.label} screenshot did not finish after 2 tries (${lastError.slice(0, 200)}). The key is fine; the page was slow to load.`, missingPermission: [], durationMs: Date.now() - started };
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 402) return { ok: false, error: `The screenshot key "${selected.label}" is used up or refused (${res.status}). Turn on another key in Admin Brain.`, missingPermission: [], durationMs: Date.now() - started };
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return { ok: false, error: `ScreenshotOne did not return a screenshot (${res.status}): ${(await res.text()).slice(0, 200)}`, missingPermission: [], durationMs: Date.now() - started };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${opts.userId}/${opts.projectId}/${Date.now()}-${shots.length}.jpg`;
    const { error } = await supabaseAdmin.storage.from("browser-checks").upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error("could not save the private screenshot.");
    shots.push({ label: s.label, url: path });
  }
  return { ok: true, findings: cleanFindings({}), shots, accountLabel: `ScreenshotOne · ${selected.label}`, durationMs: Date.now() - started, missingPermission: [] };
}
