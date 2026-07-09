import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, getSiteUserFromRequest, jsonResponse, resolveProject } from "@/lib/site-backend.server";

export const Route = createFileRoute("/api/public/sites/auth/me")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      GET: async ({ request }) => {
        const slug = new URL(request.url).searchParams.get("slug");
        if (!slug) return jsonResponse({ error: "slug required" }, 400);
        const project = await resolveProject(slug);
        if (!project) return jsonResponse({ error: "Site not found" }, 404);
        const user = await getSiteUserFromRequest(request, project.id);
        return jsonResponse({ user });
      },
      POST: async ({ request }) => {
        // signout
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        if (token) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { hashToken } = await import("@/lib/site-backend.server");
          await supabaseAdmin.from("site_sessions").delete().eq("token_hash", await hashToken(token));
        }
        return jsonResponse({ ok: true });
      },
    },
  },
});