import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Hosts that serve the Forge app itself. Anything else that reaches us is a
// customer's connected custom domain, and should serve their published site.
function isForgeHost(host: string) {
  const h = host.split(":")[0]!.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovable.dev") ||
    h.endsWith(".lovableproject.com") ||
    h === (process.env.FORGE_APP_HOST || "").toLowerCase()
  );
}

async function serveCustomDomain(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  if (url.pathname !== "/") return null;
  const host = (request.headers.get("host") || url.host).split(":")[0]!.toLowerCase();
  if (!host || isForgeHost(host)) return null;

  const candidates = host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: domain } = await supabaseAdmin
    .from("project_domains")
    .select("project_id,hostname")
    .in("hostname", candidates)
    .limit(1)
    .maybeSingle();
  if (!domain) return null;

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id,name,published")
    .eq("id", domain.project_id)
    .maybeSingle();

  const { notFoundHtml, renderProjectHtml } = await import("./lib/render-site.server");
  if (!project || !project.published) {
    return new Response(
      notFoundHtml("This domain is connected, but the site hasn't been published yet."),
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  return renderProjectHtml({
    projectId: project.id,
    projectName: project.name,
    requestUrl: request.url,
    navLinkBase: "/",
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const custom = await serveCustomDomain(request).catch(() => null);
      if (custom) return custom;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

