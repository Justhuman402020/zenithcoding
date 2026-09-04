import { createFileRoute } from "@tanstack/react-router";
import { servePublishedSiteBySlug } from "@/lib/serve-published-site.server";

export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        servePublishedSiteBySlug(params.slug, new URL(request.url).searchParams.get("page")),
    },
  },
});
