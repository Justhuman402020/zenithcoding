import { createFileRoute } from "@tanstack/react-router";
import {
  corsPreflight,
  hashToken,
  jsonResponse,
  makeSessionToken,
  resolveProject,
  validEmail,
  verifyPassword,
} from "@/lib/site-backend.server";

export const Route = createFileRoute("/api/public/sites/auth/signin")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      POST: async ({ request }) => {
        let body: { slug?: string; email?: string; password?: string };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }
        if (!body.slug || !validEmail(body.email) || typeof body.password !== "string") {
          return jsonResponse({ error: "Invalid credentials" }, 400);
        }
        const project = await resolveProject(String(body.slug));
        if (!project) return jsonResponse({ error: "Site not found" }, 404);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const email = String(body.email).toLowerCase().trim();
        const { data: user } = await supabaseAdmin
          .from("site_users")
          .select("id, email, display_name, password_hash, created_at")
          .eq("project_id", project.id)
          .eq("email", email)
          .maybeSingle();
        if (!user || !(await verifyPassword(body.password, user.password_hash))) {
          return jsonResponse({ error: "Invalid email or password" }, 401);
        }

        const token = makeSessionToken();
        const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
        await supabaseAdmin.from("site_sessions").insert({
          site_user_id: user.id,
          project_id: project.id,
          token_hash: await hashToken(token),
          expires_at: expires,
        });
        return jsonResponse({
          token,
          expiresAt: expires,
          user: { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at },
        });
      },
    },
  },
});