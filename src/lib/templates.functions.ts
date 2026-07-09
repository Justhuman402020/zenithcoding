import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function publicClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const listTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const supa = publicClient();
  const { data } = await supa
    .from("templates")
    .select("id,slug,name,description,category,thumbnail_url,featured")
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
});

export const remixTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { templateId: string; name?: string }) =>
    z.object({ templateId: z.string().uuid(), name: z.string().max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tpl } = await supabaseAdmin
      .from("templates")
      .select("id,name,description,files")
      .eq("id", data.templateId)
      .maybeSingle();
    if (!tpl) throw new Error("Template not found");

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("personal", true)
      .maybeSingle();

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: data.name ?? tpl.name,
        description: tpl.description ?? null,
        workspace_id: ws?.id ?? null,
        template_id: tpl.id,
      })
      .select("id")
      .single();
    if (error || !project) throw new Error(error?.message ?? "Failed to create project");

    const files = tpl.files as Record<string, string> | null;
    if (files && typeof files === "object") {
      const rows = Object.entries(files).map(([path, content]) => ({
        project_id: project.id,
        user_id: userId,
        path,
        content: String(content ?? ""),
      }));
      if (rows.length) {
        const { error: fErr } = await supabase.from("files").insert(rows);
        if (fErr) throw new Error(fErr.message);
      }
    }
    return { projectId: project.id };
  });