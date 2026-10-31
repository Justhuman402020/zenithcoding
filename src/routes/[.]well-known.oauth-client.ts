import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/.well-known/oauth-client")({ server: { handlers: { GET: async ({ request }) => {
  const { allowedScrolltideOrigin } = await import("@/lib/runtime-mcp/scrolltide-policy");
  try {
    const origin = allowedScrolltideOrigin(new URL(request.url).origin);
    return Response.json({ client_id: `${origin}/.well-known/oauth-client`, client_name: "Code Haven", client_uri: origin, redirect_uris: [`${origin}/api/public/mcp/scrolltide/callback`], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
  } catch { return new Response("Not available", { status: 400 }); }
} } } });