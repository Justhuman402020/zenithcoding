// AES-GCM encryption for per-project secrets. Key comes from FORGE_SECRETS_ENCRYPTION_KEY
// (64-char hex → 32 bytes). Payload format: base64(iv || ciphertext+tag).

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(new ArrayBuffer(Math.floor(clean.length / 2)));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.FORGE_SECRETS_ENCRYPTION_KEY;
  if (!secret) throw new Error("FORGE_SECRETS_ENCRYPTION_KEY missing");

  // Accept any secret: exact 64-char hex is used as-is, anything else is
  // hashed to a valid 32-byte AES key so importKey never gets a bad length.
  let raw: Uint8Array;
  const clean = secret.trim();
  if (/^[0-9a-f]{64}$/i.test(clean)) {
    raw = hexToBytes(clean);
  } else {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clean));
    raw = new Uint8Array(digest);
  }

  return crypto.subtle.importKey("raw", raw as unknown as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const enc = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    enc as unknown as BufferSource,
  );
  const cipherBytes = new Uint8Array(cipher);
  const out = new Uint8Array(new ArrayBuffer(iv.length + cipherBytes.length));
  out.set(iv, 0);
  out.set(cipherBytes, iv.length);
  return b64encode(out);
}

export async function decryptSecret(payload: string): Promise<string> {
  const key = await getKey();
  const bytes = b64decode(payload);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    cipher as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export function maskValue(v: string): string {
  if (v.length <= 6) return "•".repeat(v.length);
  return v.slice(0, 3) + "•".repeat(Math.max(4, v.length - 6)) + v.slice(-3);
}

export function validKeyName(k: unknown): k is string {
  return typeof k === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(k);
}