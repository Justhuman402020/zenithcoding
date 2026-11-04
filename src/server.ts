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
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pageForPath, verifyHostSignature, domainPair, shouldServeDomain } = await import("./lib/domain-policy");
  // Customer domains arrive through Code Haven's Cloudflare forwarder with a signed host header.
  const forwarded = request.headers.get("x-code-haven-host")?.toLowerCase() ?? "";
  let host = "";
  let viaForwarder = false;
  if (forwarded && (await verifyHostSignature(process.env.DOMAIN_PROXY_SECRET, forwarded, request.headers.get("x-code-haven-sig")))) {
    host = forwarded;
    viaForwarder = true;
  } else {
    const direct = (request.headers.get("host") || url.host).split(":")[0]!.toLowerCase();
    if (!direct || isForgeHost(direct)) return null;
    host = direct;
  }
  const page = pageForPath(url.pathname);
  if (!page) return null;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("project_domains")
    .select("project_id,hostname,is_primary,status")
    .in("hostname", domainPair(host));
  const domain = shouldServeDomain(host, (rows ?? []) as any);
  const { notFoundHtml, renderProjectHtml } = await import("./lib/render-site.server");
  const noStore = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  if (!domain) {
    // A disconnected or unknown domain never falls through to the Code Haven app.
    if (!viaForwarder) return null;
    return new Response(notFoundHtml("This domain is not connected."), { status: 404, headers: noStore });
  }

  const { data: primary } = await supabaseAdmin
    .from("project_domains")
    .select("hostname")
    .eq("project_id", domain.project_id)
    .eq("is_primary", true)
    .eq("status", "live")
    .maybeSingle();
  if (primary && primary.hostname !== host) {
    return Response.redirect(`https://${primary.hostname}${url.pathname}${url.search}`, 301);
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id,name,published")
    .eq("id", domain.project_id)
    .maybeSingle();

  if (!project || !project.published) {
    return new Response(
      notFoundHtml("This domain is connected, but the site hasn't been published yet."),
      { status: 404, headers: noStore },
    );
  }

  const renderUrl = new URL(request.url);
  if (!renderUrl.searchParams.has("page") && page !== "index.html") renderUrl.searchParams.set("page", page);
  const rendered = await renderProjectHtml({
    projectId: project.id,
    projectName: project.name,
    requestUrl: renderUrl.toString(),
    navLinkBase: "/",
  });
  const out = new Response(rendered.body, rendered);
  out.headers.set("x-code-haven-site", project.id);
  out.headers.set("cache-control", "no-store");
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const custom = await serveCustomDomain(request).catch(() => null);
      if (custom) return custom;
      const handler = await getServerEntry();
      const { requestCtx } = await import("./lib/wait-until.server");
      const response = await requestCtx.run(ctx as never, () => handler.fetch(request, env, ctx));
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

