import { injectPreviewAssets, type PreviewFile } from "./preview-assets";

export function attachedPreviewProject(projectId: string | null, openedId: string | null): string | null {
  return projectId && projectId === openedId ? projectId : null;
}

export function previewSourceFiles(files: PreviewFile[]): PreviewFile[] {
  return files.filter((file) => !file.path.startsWith(".code-haven-build/"));
}

export function previewPath(path: string, from = "index.html"): string {
  const raw = path.trim().split(/[?#]/)[0];
  if (!raw || raw === "/") return "index.html";
  const base = raw.startsWith("/") ? "" : from.split("/").slice(0, -1).join("/");
  const parts: string[] = [];
  for (const part of `${base}/${raw}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/") || "index.html";
}

export function projectPreviewDocument(files: PreviewFile[], path = "index.html"): string {
  const map = new Map(files.map((file) => [previewPath(file.path), file.content]));
  const current = map.has(path) ? path : "index.html";
  let html = map.get(current) ?? "<!doctype html><html><body>No preview files yet.</body></html>";
  html = html.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, (tag, href: string) => {
    if (/^(https?:|\/\/|data:|#)/i.test(href)) return tag;
    const css = map.get(previewPath(href, current));
    return css == null ? tag : `<style>${css}</style>`;
  });
  html = html.replace(/<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, pre: string, src: string, post: string) => {
    if (/^(https?:|\/\/|data:|#)/i.test(src)) return tag;
    const js = map.get(previewPath(src, current));
    return js == null ? tag : `<script ${pre}${post}>${js}\n</script>`;
  });
  const navigation = `<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';if(!h||/^[a-z][a-z0-9+.-]*:/i.test(h)||h.startsWith('//')||h.startsWith('#'))return;e.preventDefault();parent.postMessage({type:'forge-preview-navigate',path:h},'*');});<\/script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${navigation}</body>`) : html + navigation;
  return injectPreviewAssets(html, files);
}