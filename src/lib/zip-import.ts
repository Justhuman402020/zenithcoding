import { unzipSync, strFromU8 } from "fflate";

const SKIP = /(^|\/)(__MACOSX|node_modules|\.git|\.DS_Store|Thumbs\.db)(\/|$)/i;
const BINARY: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ico: "image/x-icon", avif: "image/avif", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
};
const MAX_FILE = 4_000_000;

function toBase64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Unpack a zip in the browser. Text files keep their text; images/fonts become data: URLs. */
export async function unpackZip(file: File): Promise<{ files: { path: string; content: string }[]; skipped: number }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  let paths = Object.keys(entries).filter((p) => !p.endsWith("/") && !SKIP.test(p));
  // Strip a single shared top-level folder wrapper (e.g. trust-wallet-clone/...)
  while (paths.length && paths.every((p) => p.includes("/"))) {
    const top = paths[0].split("/")[0];
    if (!paths.every((p) => p.startsWith(top + "/"))) break;
    paths = paths.map((p) => p.slice(top.length + 1));
    for (const k of Object.keys(entries)) {
      if (k.startsWith(top + "/")) entries[k.slice(top.length + 1)] = entries[k];
    }
  }
  const files: { path: string; content: string }[] = [];
  let skipped = 0;
  for (const path of paths) {
    const data = entries[path];
    if (!data || !path || data.length > MAX_FILE) { skipped++; continue; }
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = BINARY[ext];
    if (mime) files.push({ path, content: `data:${mime};base64,${toBase64(data)}` });
    else {
      const text = strFromU8(data);
      if (text.includes("\u0000")) { skipped++; continue; }
      files.push({ path, content: text });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}
