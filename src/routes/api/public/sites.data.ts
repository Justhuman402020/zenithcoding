import { createFileRoute } from "@tanstack/react-router";
import {
  corsPreflight,
  getSiteUserFromRequest,
  jsonResponse,
  resolveProject,
  validCollection,
} from "@/lib/site-backend.server";

// GET  ?slug=&collection=&scope=own|public|all&limit=&offset=   list rows
// POST { slug, collection, data, is_public? }                    insert (requires auth unless is_public list allows)
// PATCH { slug, id, data }                                       update own row
// DELETE { slug, id }                                            delete own row
export const Route = createFileRoute("/api/public/sites/data")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const slug = url.searchParams.get("slug");
        const collection = url.searchParams.get("collection");
        const scope = url.searchParams.get("scope") ?? "public";
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
        const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));
        if (!slug || !validCollection(collection)) return jsonResponse({ error: "slug + collection required" }, 400);
        const project = await resolveProject(slug);
        if (!project) return jsonResponse({ error: "Site not found" }, 404);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let q = supabaseAdmin
          .from("site_data")
          .select("id, data, is_public, owner_site_user_id, created_at, updated_at")
          .eq("project_id", project.id)
          .eq("collection", collection)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (scope === "own") {
          const user = await getSiteUserFromRequest(request, project.id);
          if (!user) return jsonResponse({ error: "Sign in required" }, 401);
          q = q.eq("owner_site_user_id", user.id);
        } else if (scope === "all") {
          // "all" = own rows + all public rows
          const user = await getSiteUserFromRequest(request, project.id);
          if (user) q = q.or(`is_public.eq.true,owner_site_user_id.eq.${user.id}`);
          else q = q.eq("is_public", true);
        } else {
          q = q.eq("is_public", true);
        }
        const { data, error } = await q;
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ rows: data ?? [] });
      },

      POST: async ({ request }) => {
        let body: { slug?: string; collection?: string; data?: unknown; is_public?: boolean };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }
        if (!body.slug || !validCollection(body.collection)) return jsonResponse({ error: "slug + collection required" }, 400);
        const project = await resolveProject(String(body.slug));
        if (!project) return jsonResponse({ error: "Site not found" }, 404);
        const user = await getSiteUserFromRequest(request, project.id);
        if (!user) return jsonResponse({ error: "Sign in required to write data" }, 401);
        const payload = body.data && typeof body.data === "object" ? body.data : {};
        const serialized = JSON.stringify(payload);
        if (serialized.length > 100_000) return jsonResponse({ error: "Row too large (100KB max)" }, 413);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("site_data")
          .insert({
            project_id: project.id,
            collection: body.collection!,
            owner_site_user_id: user.id,
            data: payload as never,
            is_public: !!body.is_public,
          })
          .select("id, data, is_public, owner_site_user_id, created_at, updated_at")
          .single();
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ row: data });
      },

      PATCH: async ({ request }) => {
        let body: { slug?: string; id?: string; data?: unknown; is_public?: boolean };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }
        if (!body.slug || !body.id) return jsonResponse({ error: "slug + id required" }, 400);
        const project = await resolveProject(String(body.slug));
        if (!project) return jsonResponse({ error: "Site not found" }, 404);
        const user = await getSiteUserFromRequest(request, project.id);
        if (!user) return jsonResponse({ error: "Sign in required" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: Record<string, unknown> = {};
        if (body.data && typeof body.data === "object") patch.data = body.data as never;
        if (typeof body.is_public === "boolean") patch.is_public = body.is_public;
        const { data, error } = await supabaseAdmin
          .from("site_data")
          .update(patch as never)
          .eq("id", body.id)
          .eq("project_id", project.id)
          .eq("owner_site_user_id", user.id)
          .select("id, data, is_public, owner_site_user_id, created_at, updated_at")
          .maybeSingle();
        if (error) return jsonResponse({ error: error.message }, 500);
        if (!data) return jsonResponse({ error: "Row not found or not yours" }, 404);
        return jsonResponse({ row: data });
      },

      DELETE: async ({ request }) => {
        let body: { slug?: string; id?: string };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }
        if (!body.slug || !body.id) return jsonResponse({ error: "slug + id required" }, 400);
        const project = await resolveProject(String(body.slug));
        if (!project) return jsonResponse({ error: "Site not found" }, 404);
        const user = await getSiteUserFromRequest(request, project.id);
        if (!user) return jsonResponse({ error: "Sign in required" }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("site_data")
          .delete()
          .eq("id", body.id)
          .eq("project_id", project.id)
          .eq("owner_site_user_id", user.id);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      },
    },
  },
});