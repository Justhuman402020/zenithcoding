import { createFileRoute } from "@tanstack/react-router";
import {
  corsPreflight,
  hashPassword,
  hashToken,
  jsonResponse,
  makeSessionToken,
  resolveProject,
  validEmail,
} from "@/lib/site-backend.server";

export const Route = createFileRoute("/api/public/sites/auth/signup")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      POST: async ({ request }) => {
        let body: { slug?: string; email?: string; password?: string; displayName?: string };
        try { body = await request.json(); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }
        if (!body.slug || !validEmail(body.email) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) {
          return jsonResponse({ error: "Invalid email or password (min 8 chars)" }, 400);
        }
        const project = await resolveProject(String(body.slug));
        if (!project) return jsonResponse({ error: "Site not found" }, 404);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const email = String(body.email).toLowerCase().trim();
        const password_hash = await hashPassword(body.password);
        const { data: user, error } = await supabaseAdmin
          .from("site_users")
          .insert({
            project_id: project.id,
            email,
            password_hash,
            display_name: body.displayName?.slice(0, 80) ?? null,
          })
          .select("id, email, display_name, created_at")
          .single();
        if (error) {
          if (String(error.message).toLowerCase().includes("duplicate")) {
            return jsonResponse({ error: "That email is already registered on this site." }, 409);
          }
          return jsonResponse({ error: "Could not create account" }, 500);
        }

        const token = makeSessionToken();
        const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
        await supabaseAdmin.from("site_sessions").insert({
          site_user_id: user.id,
          project_id: project.id,
          token_hash: await hashToken(token),
          expires_at: expires,
        });
        return jsonResponse({ token, expiresAt: expires, user });
      },
    },
  },
});