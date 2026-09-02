// Shared helpers for a project's public URL.
// Every project gets a unique, clean path URL: /s/<projectname>-<xxxxx>

export function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function randomSuffix(len = 5): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(len);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  } else {
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** projectname-xxxxx — unique enough to never collide in practice. */
export function makeProjectSlug(name: string): string {
  const base = normalizeSlug(name).slice(0, 28) || "site";
  return `${base}-${randomSuffix()}`;
}

export function projectSiteUrl(slug: string): string {
  if (!slug) return "";
  if (typeof window === "undefined") return `/s/${slug}`;
  return `${window.location.origin}/s/${slug}`;
}
