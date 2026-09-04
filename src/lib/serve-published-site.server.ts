// Server-only: renders published Forge projects as standalone HTML pages.
// Shared by the /s/$slug route and by custom-domain Host-header routing
// (src/server.ts), so a verified domain serves its project from the root path.

import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | undefined;

function anonClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Server not configured: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing");
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

type PublicProject = { id: string; name: string; slug: string };
type FileRow = { path: string; content: string; kind?: string };

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

async function renderProjectSite(
  project: PublicProject,
  pageParam: string | null | undefined,
  linkBase: string,
): Promise<Response> {
  const supabase = anonClient();

  const { data: files } = await supabase
    .from("files")
    .select("path,content,kind")
    .eq("project_id", project.id);

  // Prefer built artifacts (kind='build') when present; otherwise fall back to source.
  const rows = (files ?? []) as unknown as FileRow[];
  const built = rows.filter((r) => r.kind === "build");
  const source = rows.filter((r) => r.kind !== "build");
  const serving = built.length > 0 ? built : source;
  const map = new Map(serving.map((f) => [normalizeAssetPath(f.path), f.content]));
  const requestedPage = resolveProjectPath(pageParam ?? "index.html");
  const currentPath = map.has(requestedPage) ? requestedPage : "index.html";
  const currentHtml = map.get(currentPath);
  if (!currentHtml) {
    return new Response(emptyHtml(project.name), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Inline <link href="..."> CSS and <script src="..."> JS from project files
  let html = currentHtml.replace(
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g,
    (m: string, href: string) => {
      if (/^(https?:)?\/\//i.test(href) || href.startsWith("data:") || href.startsWith("#")) return m;
      const css = map.get(resolveProjectPath(href, currentPath));
      if (css == null) return m;
      return `<style data-from="${href}">${css}</style>`;
    },
  );
  html = html.replace(
    /<script\s+([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/g,
    (m: string, pre: string, src: string, post: string) => {
      if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("#")) return m;
      const js = map.get(resolveProjectPath(src, currentPath));
      if (js == null) return m;
      const attrs = `${pre}${post}`.trim();
      return `<script${attrs ? ` ${attrs}` : ""} data-from="${src}">${js}\n//# sourceURL=${src}</script>`;
    },
  );
  const base = linkBase.replace(/\/$/, "");
  const navigationBridge = `<script>\n(() => {\n  document.addEventListener('click', (event) => {\n    const link = event.target.closest && event.target.closest('a[href]');\n    if (!link) return;\n    const href = link.getAttribute('href') || '';\n    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(href)) return;\n    event.preventDefault();\n    window.location.href = '${base}${base ? "" : "?"}page=' + encodeURIComponent(href);\n  });\n})();\n<\/script>`;
  const forgeSdk = `<script src="/forge-sdk.js" defer></script>`;
  const forgeBadge = `<a href="/" target="_blank" rel="noopener" style="position:fixed;bottom:14px;right:14px;z-index:2147483647;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:linear-gradient(135deg,#0a0a0a,#171717);color:#f0d78c;font:500 11px/1 'Work Sans',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;box-shadow:0 8px 24px -8px rgba(0,0,0,.6),0 0 0 1px rgba(201,168,76,.35),inset 0 1px 0 rgba(240,215,140,.12);backdrop-filter:blur(8px)" aria-label="Made with Forge"><span style="width:6px;height:6px;border-radius:999px;background:linear-gradient(135deg,#b8923a,#f0d78c);box-shadow:0 0 8px rgba(240,215,140,.7)"></span>Made with Forge</a>`;
  const injection = `${forgeSdk}${navigationBridge}${forgeBadge}`;
  html = html.includes("</body>") ? html.replace(/<\/body>/i, `${injection}</body>`) : `${html}${injection}`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30",
    },
  });
}

/** Serve a published site by its /s/<slug> URL. 404s when not found or unpublished. */
export async function servePublishedSiteBySlug(
  slug: string,
  pageParam: string | null | undefined,
): Promise<Response> {
  const supabase = anonClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id,name,slug,published")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (!project) {
    return new Response(notFoundHtml(slug), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return renderProjectSite(project as PublicProject, pageParam, `/s/${project.slug}`);
}

// --- Custom-domain routing -------------------------------------------------
// When a request's Host header matches a verified project_domain, serve that
// project from the root path (/?page=...), mirroring /s/<slug> behavior.

const DOMAIN_CACHE_TTL_MS = 60_000;
const domainCache = new Map<string, { project: PublicProject | null; at: number }>();

async function lookupVerifiedDomain(host: string): Promise<PublicProject | null> {
  const cached = domainCache.get(host);
  if (cached && Date.now() - cached.at < DOMAIN_CACHE_TTL_MS) return cached.project;

  const supabase = anonClient();
  const resolve = async (hostname: string) => {
    const { data: domain } = await supabase
      .from("project_domains")
      .select("project_id,hostname,verified")
      .eq("hostname", hostname)
      .eq("verified", true)
      .maybeSingle();
    if (!domain) return null;
    const { data: project } = await supabase
      .from("projects")
      .select("id,name,slug,published")
      .eq("id", domain.project_id)
      .eq("published", true)
      .maybeSingle();
    return (project as PublicProject) ?? null;
  };

  let project = await resolve(host);
  // www.example.com → fall back to the bare domain's project.
  if (!project && host.startsWith("www.")) project = await resolve(host.slice(4));
  domainCache.set(host, { project, at: Date.now() });
  return project;
}

/**
 * Serve a verified custom domain's published site, or null to fall through to
 * the app. Only the root path is intercepted; ?page= handles internal
 * navigation and everything else (/forge-sdk.js, app routes) passes through.
 */
export async function servePublishedSiteForRequest(request: Request): Promise<Response | null> {
  let host: string;
  try {
    const url = new URL(request.url);
    if (url.pathname !== "/") return null;
    host = (request.headers.get("host") ?? "").trim().toLowerCase();
  } catch {
    return null;
  }
  if (!host || host.startsWith("localhost") || host.startsWith("127.0.") || host.startsWith("0.0.0.0")) {
    return null;
  }
  host = host.split(":")[0];
  if (!host.includes(".")) return null;

  let project: PublicProject | null;
  try {
    project = await lookupVerifiedDomain(host);
  } catch {
    return null; // remote lookup failed — fall through to the app rather than erroring
  }
  if (!project) return null;

  const pageParam = new URL(request.url).searchParams.get("page");
  try {
    return await renderProjectSite(project, pageParam, "");
  } catch {
    return null;
  }
}

function notFoundHtml(slug: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Site not found</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0a1a;color:#e7e3f1;display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem;text-align:center}h1{font-size:2rem;margin:0 0 .5rem}p{color:#9c95b3;max-width:32rem}code{background:#1a1525;padding:.15rem .4rem;border-radius:.3rem}</style></head><body><div><h1>Site not found</h1><p>No published site at <code>/s/${escapeHtml(slug)}</code>. The owner may not have published it yet.</p></div></body></html>`;
}

function emptyHtml(name: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title></head><body style="font-family:system-ui;padding:2rem;color:#666">This site doesn't have an <code>index.html</code> yet.</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
