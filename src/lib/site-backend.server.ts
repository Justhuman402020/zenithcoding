// Server-only helpers for the per-published-site "Forge Backend" (shared DB, isolated by project_id).
// Used by /api/public/sites/* routes.

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$100000$${toHex(salt.buffer as ArrayBuffer)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = stored.split("$");
  if (algo !== "pbkdf2") return false;
  const iterations = parseInt(iterStr, 10);
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const computed = toHex(bits);
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return toHex(buf);
}

export function makeSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  return toHex(bytes.buffer as ArrayBuffer);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    },
  });
}

export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}

export async function resolveProject(slug: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, published, slug")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getSiteUserFromRequest(request: Request, projectId: string) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const th = await hashToken(token);
  const { data: session } = await supabaseAdmin
    .from("site_sessions")
    .select("id, site_user_id, project_id, expires_at")
    .eq("token_hash", th)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  const { data: user } = await supabaseAdmin
    .from("site_users")
    .select("id, email, display_name, metadata, created_at")
    .eq("id", session.site_user_id)
    .maybeSingle();
  return user;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validEmail(e: unknown): e is string {
  return typeof e === "string" && e.length <= 254 && emailRe.test(e);
}

export function validCollection(c: unknown): c is string {
  return typeof c === "string" && /^[a-z][a-z0-9_]{0,63}$/i.test(c);
}