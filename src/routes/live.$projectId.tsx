import { createFileRoute } from "@tanstack/react-router";
import { notFoundHtml, renderProjectHtml } from "@/lib/render-site.server";

// Public, per-project live URL: /live/<project-id>
// (the /p/<project-id> path is the signed-in editor, so the public one lives here)
export const Route = createFileRoute("/live/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("id,name,published")
          .eq("id", params.projectId)
          .maybeSingle();

        if (!project || !project.published) {
          return new Response(
            notFoundHtml("This project is not published yet. The owner can publish it from Forge."),
            { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }

        return renderProjectHtml({
          projectId: project.id,
          projectName: project.name,
          requestUrl: request.url,
          navLinkBase: `/live/${project.id}`,
        });
      },
    },
  },
});
