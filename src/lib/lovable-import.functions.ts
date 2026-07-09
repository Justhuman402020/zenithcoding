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

    // Seed a proper editable starter page so the preview isn't blank.
    const desc = data.description ||
      "Ask the AI on the left to rebuild this project, or open the Code tab to edit files directly. The preview updates instantly.";
    const starter = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${data.name}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin:0; min-height:100vh; display:grid; place-items:center; background: radial-gradient(1200px 600px at 50% -10%, #2a1e4a 0%, #0f0c1a 60%); color:#e8e3f5; }
  main { max-width: 720px; padding: 48px 32px; text-align:center; }
  h1 { font-size: clamp(2rem, 5vw, 3.25rem); margin:0 0 16px; background:linear-gradient(135deg,#c4b5fd,#f0abfc); -webkit-background-clip:text; color:transparent; }
  p { font-size:1.05rem; color:#c8c0e0; line-height:1.6; margin:0 auto 28px; max-width:560px; }
  .tag { display:inline-block; padding:6px 12px; border-radius:999px; border:1px solid #6d5aa855; background:#20173a80; color:#c4b5fd; font-size:.8rem; letter-spacing:.02em; margin-bottom:20px; }
  .cta { display:inline-block; padding:12px 20px; border-radius:12px; background:linear-gradient(135deg,#a78bfa,#f0abfc); color:#0f0c1a; font-weight:600; text-decoration:none; }
</style>
</head>
<body>
<main>
  <span class="tag">Imported from Lovable · ready to edit</span>
  <h1>${data.name}</h1>
  <p>${desc}</p>
  <a class="cta" href="#">Start editing →</a>
</main>
</body>
</html>`;
    await supabase.from("files").insert({
      project_id: project.id,
      user_id: userId,
      path: "index.html",
      content: starter,
    });

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
