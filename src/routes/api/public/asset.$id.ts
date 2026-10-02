import { createFileRoute } from "@tanstack/react-router";

// Serves a named project asset (image/video) from private storage at a
// stable URL so generated sites can embed it directly.
export const Route = createFileRoute("/api/public/asset/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = String(params.id).split(".")[0];
        if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("project_assets")
          .select("storage_path, content_type")
          .eq("id", id)
          .maybeSingle();
        if (!row) return new Response("Not found", { status: 404 });
        const { data: blob, error } = await supabaseAdmin.storage.from("project-assets").download(row.storage_path);
        if (error || !blob) return new Response("Not found", { status: 404 });
        return new Response(blob, {
          headers: {
            "Content-Type": row.content_type || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
