// Shared HTML rendering used by both /s/$slug (published) and /share/$token (preview).

function normalizeAssetPath(path: string): string {
  return path.trim().replace(/^\.{0,2}\/+/, "").replace(/\/+/g, "/");
}

function resolveProjectPath(path: string, fromPath = "index.html"): string {
  const raw = path.trim().split("#")[0].split("?")[0];
  if (!raw || raw === "/") return "index.html";
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return normalizeAssetPath(raw);
  const baseDir = fromPath.includes("/") ? `${fromPath.split("/").slice(0, -1).join("/")}/` : "";
  const parts: string[] = [];
  for (const part of `${baseDir}${raw}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/") || "index.html";
}

function escapeJs(s: string) {
  return s.replace(/[\\'"\n\r<>&]/g, (c) =>
    ({ "\\": "\\\\", "'": "\\'", '"': '\\"', "\n": "\\n", "\r": "\\r", "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" })[c]!,
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function notFoundHtml(what: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Not found</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0a1a;color:#e7e3f1;display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem;text-align:center}h1{font-size:2rem;margin:0 0 .5rem}p{color:#9c95b3;max-width:32rem}code{background:#1a1525;padding:.15rem .4rem;border-radius:.3rem}</style></head><body><div><h1>Not found</h1><p>${escapeHtml(what)}</p></div></body></html>`;
}

export function emptyHtml(name: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title></head><body style="font-family:system-ui;padding:2rem;color:#666">This site doesn't have an <code>index.html</code> yet.</body></html>`;
}

export interface RenderOptions {
  projectId: string;
  projectName: string;
  requestUrl: string;
  navLinkBase: string; // e.g. "/s/my-slug" or "/share/abc123"
  showBadge?: boolean;
  banner?: string; // optional HTML banner injected at top (e.g. "Preview")
  preferBuilt?: boolean;
}

export async function renderProjectHtml(opts: RenderOptions): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: files } = await supabaseAdmin
    .from("files")
    .select("path,content,kind" as any)
    .eq("project_id", opts.projectId);

  const rows = ((files ?? []) as unknown) as Array<{ path: string; content: string; kind?: string }>;
  const built = rows.filter((r) => r.kind === "build");
  const source = rows.filter((r) => r.kind !== "build");
  const serving = opts.preferBuilt !== false && built.length > 0 ? built : source;
  const map = new Map(serving.map((f) => [normalizeAssetPath(f.path), f.content]));
  const requestedPage = resolveProjectPath(new URL(opts.requestUrl).searchParams.get("page") ?? "index.html");
  const currentPath = map.has(requestedPage) ? requestedPage : "index.html";
  const currentHtml = map.get(currentPath);
  if (!currentHtml) {
    return new Response(emptyHtml(opts.projectName), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  let html = currentHtml.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g, (m, href) => {
    if (/^(https?:)?\/\//i.test(href) || href.startsWith("data:") || href.startsWith("#")) return m;
    const css = map.get(resolveProjectPath(href, currentPath));
    return css == null ? m : `<style data-from="${href}">${css}</style>`;
  });
  html = html.replace(/<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/g, (m, pre, src, post) => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("#")) return m;
    const js = map.get(resolveProjectPath(src, currentPath));
    if (js == null) return m;
    const attrs = `${pre}${post}`.trim();
    return `<script${attrs ? ` ${attrs}` : ""} data-from="${src}">${js}\n//# sourceURL=${src}</script>`;
  });

  const navigationBridge = `<script>\n(() => {\n  document.addEventListener('click', (event) => {\n    const link = event.target.closest && event.target.closest('a[href]');\n    if (!link) return;\n    const href = link.getAttribute('href') || '';\n    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return;\n    event.preventDefault();\n    window.location.href = '${escapeJs(opts.navLinkBase)}?page=' + encodeURIComponent(href);\n  });\n})();\n<\/script>`;
  const forgeSdk = `<script src="/forge-sdk.js" defer></script>`;
  const badge = opts.showBadge === false
    ? ""
    : `<a href="/" target="_blank" rel="noopener" style="position:fixed;bottom:14px;right:14px;z-index:2147483647;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:linear-gradient(135deg,#0a0a0a,#171717);color:#f0d78c;font:500 11px/1 'Work Sans',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;box-shadow:0 8px 24px -8px rgba(0,0,0,.6),0 0 0 1px rgba(201,168,76,.35),inset 0 1px 0 rgba(240,215,140,.12);backdrop-filter:blur(8px)" aria-label="Made with Forge"><span style="width:6px;height:6px;border-radius:999px;background:linear-gradient(135deg,#b8923a,#f0d78c);box-shadow:0 0 8px rgba(240,215,140,.7)"></span>Made with Forge</a>`;
  const banner = opts.banner ?? "";
  const injection = `${forgeSdk}${navigationBridge}${badge}`;
  html = html.includes("</body>") ? html.replace(/<\/body>/i, `${injection}</body>`) : `${html}${injection}`;
  if (banner) {
    html = html.includes("<body")
      ? html.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
      : `${banner}${html}`;
  }

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" },
  });
}