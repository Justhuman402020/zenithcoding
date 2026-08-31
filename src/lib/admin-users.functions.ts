import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole, isAdminRole } from "./admin-auth.server";

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const users: Array<{
      id: string;
      email: string | null;
      created_at: string;
      last_sign_in_at: string | null;
      email_confirmed_at: string | null;
      display_name: string | null;
      phone: string | null;
      is_admin: boolean;
    }> = [];
    let page = 1;
    for (;;) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        const metadata = (u.user_metadata ?? {}) as Record<string, unknown>;
        const displayName = metadata.display_name ?? metadata.full_name ?? metadata.name;
        users.push({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
          display_name: typeof displayName === "string" ? displayName.slice(0, 120) : null,
          phone: u.phone ?? null,
          is_admin: metadata.is_admin === true || metadata.role === "admin",
        });
      }
      if (data.users.length < 200) break;
      page += 1;
      if (page > 50) break;
    }

    return {
      users: users.map((u) => {
        const metadata = (u as typeof u & { user_metadata?: Record<string, unknown> }).user_metadata ?? {};
        return {
          ...u,
          project_count: 0,
          is_admin: metadata.is_admin === true || metadata.role === "admin",
        };
      }),
    };
  });

export const listUserProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("projects")
      .select("id, name, description, updated_at, published, slug, lovable_project_id")
      .eq("user_id", data.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { projects: rows ?? [] };
  });

export const deleteUserAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    if (data.userId === context.userId) throw new Error("You cannot delete your own account here.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // remove projects/files first so cascade works cleanly even if FKs are missing
    await supabaseAdmin.from("files").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("projects").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { isAdmin: await isAdminRole(context) };
  });
