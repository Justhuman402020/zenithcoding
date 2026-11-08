// MiroMiro design-extraction API (https://miromiro.app/api/docs/introduction).
// Base: https://miromiro.app/api/v1 — every call is GET ?url=... with
// Authorization: Bearer <key>. Free plan: 300 credits/month. Quota is reported
// in X-Quota-* response headers. Used to clone a linked site's design into a
// compact blueprint for the coding agent.

const BASE = "https://miromiro.app/api/v1";

export type MiroMiroResult = {
  blueprint: string;
  creditsLeft: number | null;
};

async function getMiroMiroKey(): Promise<string | null> {
  // 1) Admin → Integrations & API keys card.
  try {
    const { getIntegrationKey } = await import("./integration-keys.server");
    const k = await getIntegrationKey("miromiro", "apiKey");
    if (k) return k;
  } catch {}
  // 2) Admin vault entry labelled "miromiro" (older saves).
  try {
    const { readVaultSecret } = await import("./admin-vault.server");
    const v = await readVaultSecret("miromiro");
    if (v?.key?.trim()) return v.key.trim().replace(/^Bearer\s+/i, "");
  } catch {}
  // 3) Environment secret.
  const env = (process.env["MIROMIRO_API_KEY"] ?? "").trim().replace(/^Bearer\s+/i, "");
  return env || null;
}

async function call(key: string, path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    });
    const quota = res.headers.get("x-quota-remaining") ?? res.headers.get("x-quota-remaining-monthly");
    const creditsLeft = quota != null && quota !== "" ? Number(quota) : null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false as const, status: res.status, error: text.slice(0, 200), creditsLeft };
    }
    const json: any = await res.json().catch(() => null);
    return { ok: true as const, json, creditsLeft };
  } catch (e) {
    return { ok: false as const, status: 0, error: e instanceof Error ? e.message : "request failed", creditsLeft: null };
  } finally {
    clearTimeout(timer);
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function asList(v: any, max: number): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(typeof x === "object" ? x?.value ?? x?.url ?? x?.name ?? JSON.stringify(x) : x)).slice(0, max);
  if (typeof v === "object") return Object.entries(v).slice(0, max).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`);
  return [String(v)];
}

/** Clone a site's design via MiroMiro. Returns null when no key is saved or the call fails. */
export async function cloneSiteWithMiroMiro(url: string): Promise<MiroMiroResult | null> {
  const key = await getMiroMiroKey();
  if (!key) return null;

  // Order per docs: brand → extract (tokens) → images → code (paste-ready JSX).
  const brand = await call(key, "/brand", { url });
  if (!brand.ok) return null; // 401/429/etc — caller falls back to the simple cloner
  const extract = await call(key, "/extract", { url, fields: "colors,fontSizes,spacing,borderRadiuses" });
  const images = await call(key, "/images", { url });
  const code = await call(key, "/code", { url, framework: "jsx" });

  const creditsLeft = [code, images, extract, brand].map((r) => r.creditsLeft).find((c) => c != null) ?? null;

  const b = brand.json ?? {};
  const e = extract.json ?? {};
  const lines: string[] = [`Source: ${url} (read with MiroMiro)`];
  const brandBits = [
    b.name && `Name: ${b.name}`,
    b.tagline && `Tagline: ${b.tagline}`,
    b.description && `About: ${clip(String(b.description), 200)}`,
  ].filter(Boolean) as string[];
  if (brandBits.length) lines.push(brandBits.join(" · "));
  const colors = asList(e.colors ?? b.colors, 8);
  if (colors.length) lines.push(`Colors: ${colors.join(", ")}`);
  const fonts = asList(e.fonts ?? e.fontFamilies ?? b.fonts, 3);
  if (fonts.length) lines.push(`Fonts: ${fonts.join(", ")}`);
  const sizes = asList(e.fontSizes, 8);
  if (sizes.length) lines.push(`Font sizes: ${sizes.join(", ")}`);
  const radii = asList(e.borderRadiuses, 5);
  if (radii.length) lines.push(`Corner radii: ${radii.join(", ")}`);
  const spacing = asList(e.spacing, 6);
  if (spacing.length) lines.push(`Spacing scale: ${spacing.join(", ")}`);
  const imgs = asList(images.json?.images ?? images.json, 8).filter((u) => /^https?:\/\//.test(u));
  if (imgs.length) lines.push(`Images: ${imgs.join(" ")}`);
  const codeText = typeof code.json === "string" ? code.json : code.json?.code ?? code.json?.sections ? JSON.stringify(code.json).slice(0, 0) : "";
  if (codeText) lines.push(`Reference structure (from the real page, rewrite it — do not copy verbatim):\n${clip(codeText, 2500)}`);

  return { blueprint: clip(lines.join("\n"), 5000), creditsLeft };
}

/** Quick credit check for the Admin "Test" button. */
export async function testMiroMiroKey(key: string): Promise<{ ok: boolean; message: string }> {
  const r = await call(key.trim().replace(/^Bearer\s+/i, ""), "/brand", { url: "https://example.com" });
  if (r.ok) {
    const credits = r.creditsLeft != null ? ` · about ${r.creditsLeft} credits left this month` : "";
    return { ok: true, message: `Key works${credits}` };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, message: "Key rejected — check it was copied fully" };
  if (r.status === 429) return { ok: false, message: "Key works but this month's credits are used up" };
  return { ok: false, message: `${r.status || "Error"}: ${r.error || "could not reach MiroMiro"}` };
}
