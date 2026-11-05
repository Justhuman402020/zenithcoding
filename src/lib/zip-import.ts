import { unzipSync, strFromU8 } from "fflate";

const SKIP = /(^|\/)(__MACOSX|node_modules|\.git|\.DS_Store|Thumbs\.db)(\/|$)/i;
const BINARY: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ico: "image/x-icon", avif: "image/avif", bmp: "image/bmp", apng: "image/apng",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
};
const MAX_FILE = 4_000_000;

function toBase64(u8: Uint8Array) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** True when the file is a zip — checks the name, the type, or the "PK" bytes at the start (phones often hide the name/type). */
export async function isZipFile(file: File): Promise<boolean> {
  if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b;
  } catch {
    return false;
  }
}

/** Unpack a zip in the browser. Text files keep their text; images/fonts become data: URLs. */
export async function unpackZip(file: File): Promise<{ files: { path: string; content: string }[]; skipped: number }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  let paths = Object.keys(entries).filter((p) => !p.endsWith("/") && !SKIP.test(p));
  // Strip a single shared top-level folder wrapper (e.g. trust-wallet-clone/...)
  while (paths.length && paths.every((p) => p.includes("/"))) {
    const top = paths[0].split("/")[0];
    if (!paths.every((p) => p.startsWith(top + "/"))) break;
    // Never strip a real project folder such as src/ — only a wrapper folder.
    if (/^(src|public|app|assets|components|pages|lib|static)$/i.test(top)) break;
    paths = paths.map((p) => p.slice(top.length + 1));
    for (const k of Object.keys(entries)) {
      if (k.startsWith(top + "/")) entries[k.slice(top.length + 1)] = entries[k];
    }
  }
  const files: { path: string; content: string }[] = [];
  let skipped = 0;
  for (const path of paths) {
    const data = entries[path];
    if (!data || !path) { skipped++; continue; }
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = BINARY[ext];
    if (mime) files.push({ path, content: `data:${mime};base64,${toBase64(data)}` });
    else {
      if (data.length > MAX_FILE) { skipped++; continue; }
      const text = strFromU8(data);
      if (text.includes("\u0000")) { skipped++; continue; }
      files.push({ path, content: text });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // Build runner: save the missing Vite/React setup once, under the hidden
  // .code-haven-build/scaffold/ folder. The user's own files are never replaced.
  const { scaffoldBuild } = await import("./zip-scaffold");
  const userFiles = files.filter((f) => !f.path.startsWith(".code-haven-build/"));
  for (const added of scaffoldBuild(userFiles).added) {
    const i = files.findIndex((f) => f.path === added.path);
    if (i >= 0) files[i] = added; else files.push(added);
  }
  return { files, skipped };
}
