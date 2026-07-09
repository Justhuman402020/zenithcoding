import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwnsProject(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("Project not found");
}

export const listProjectSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { maskValue, decryptSecret } = await import("./secrets-crypto.server");
    const { data: rows, error } = await supabaseAdmin
      .from("project_secrets")
      .select("id, key, value_encrypted, expose_to_client, description, updated_at")
      .eq("project_id", data.projectId)
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    const secrets = await Promise.all(
      (rows ?? []).map(async (r) => ({
        id: r.id,
        key: r.key,
        masked: maskValue(await decryptSecret(r.value_encrypted)),
        expose_to_client: r.expose_to_client,
        description: r.description,
        updated_at: r.updated_at,
      })),
    );
    return { secrets };
  });

export const upsertProjectSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    projectId: string;
    key: string;
    value: string;
    expose_to_client?: boolean;
    description?: string;
  }) =>
    z.object({
      projectId: z.string().uuid(),
      key: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Use SCREAMING_SNAKE_CASE (letters, digits, underscores)"),
      value: z.string().min(1).max(24_000),
      expose_to_client: z.boolean().optional(),
      description: z.string().max(300).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const value_encrypted = await encryptSecret(data.value);
    const { error } = await supabaseAdmin
      .from("project_secrets")
      .upsert(
        {
          project_id: data.projectId,
          user_id: context.userId,
          key: data.key,
          value_encrypted,
          expose_to_client: !!data.expose_to_client,
          description: data.description ?? null,
        },
        { onConflict: "project_id,key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProjectSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; id: string }) =>
    z.object({ projectId: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("project_secrets")
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });