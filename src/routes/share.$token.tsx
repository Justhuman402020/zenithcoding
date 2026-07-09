import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/share/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { renderProjectHtml, notFoundHtml } = await import("@/lib/render-site.server");

        const { data: link } = await supabaseAdmin
          .from("share_links")
          .select("id, project_id, expires_at, revoked")
          .eq("token", params.token)
          .maybeSingle();

        if (!link || link.revoked || new Date(link.expires_at).getTime() < Date.now()) {
          return new Response(
            notFoundHtml("This share link has expired or was revoked. Ask the project owner for a new one."),
            { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }

        const { data: project } = await supabaseAdmin
          .from("projects").select("id, name").eq("id", link.project_id).maybeSingle();
        if (!project) {
          return new Response(notFoundHtml("Project not found."), {
            status: 404, headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        // Fire-and-forget view count bump
        void supabaseAdmin
          .from("share_links")
          .update({ view_count: (link as any).view_count ? (link as any).view_count + 1 : 1 })
          .eq("id", link.id);

        const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483646;background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;padding:6px 14px;font:500 12px/1.4 system-ui,-apple-system,sans-serif;text-align:center;letter-spacing:.02em;box-shadow:0 2px 8px rgba(0,0,0,.3)">Preview shared via Forge · expires ${new Date(link.expires_at).toLocaleDateString()}</div>`;
        return renderProjectHtml({
          projectId: project.id,
          projectName: project.name ?? "Preview",
          requestUrl: request.url,
          navLinkBase: `/share/${params.token}`,
          banner,
        });
      },
    },
  },
});