import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getLovableImportedProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,updated_at,published,slug,lovable_project_id")
      .eq("user_id", userId)
      .not("lovable_project_id", "is", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return { projects: data ?? [] };
  });

export const importLovableProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lovableProjectId: string; name: string; description?: string; slug?: string }) =>
    z.object({
      lovableProjectId: z.string().uuid(),
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      slug: z.string().max(40).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("projects")
      .select("id")
      .eq("lovable_project_id", data.lovableProjectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) throw new Error("This Lovable project has already been imported.");

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description || null,
        lovable_project_id: data.lovableProjectId,
        slug: data.slug || null,
      })
      .select("id")
      .single();
    if (error) throw error;

    return { projectId: project.id };
  });

export const deleteLovableImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .not("lovable_project_id", "is", null);
    if (error) throw error;
    return { ok: true };
  });
