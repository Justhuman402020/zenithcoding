import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, jsonResponse, resolveProject } from "@/lib/site-backend.server";

// Returns ONLY secrets the project owner explicitly marked expose_to_client.
// The rest stay server-only and are never sent to the browser.
export const Route = createFileRoute("/api/public/sites/env")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      GET: async ({ request }) => {
        const slug = new URL(request.url).searchParams.get("slug");
        if (!slug) return jsonResponse({ error: "slug required" }, 400);
        const project = await resolveProject(slug);
        if (!project) return jsonResponse({ error: "Site not found" }, 404);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptSecret } = await import("@/lib/secrets-crypto.server");
        const { data: rows } = await supabaseAdmin
          .from("project_secrets")
          .select("key, value_encrypted")
          .eq("project_id", project.id)
          .eq("expose_to_client", true);
        const env: Record<string, string> = {};
        for (const r of rows ?? []) {
          try { env[r.key] = await decryptSecret(r.value_encrypted); } catch { /* skip */ }
        }
        return jsonResponse({ env });
      },
    },
  },
});