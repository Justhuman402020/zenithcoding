import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwnsProject } from "./project-secrets.server";

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
    const { encryptSecret, decryptSecret } = await import("./secrets-crypto.server");
    const cleanValue = data.value.trim();
    const value_encrypted = await encryptSecret(cleanValue);
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
    const { data: saved, error: verifyError } = await supabaseAdmin
      .from("project_secrets")
      .select("value_encrypted")
      .eq("project_id", data.projectId)
      .eq("key", data.key)
      .maybeSingle();
    if (verifyError || !saved) throw new Error(verifyError?.message ?? "The API key was not saved");
    const verified = await decryptSecret(saved.value_encrypted);
    if (verified !== cleanValue) throw new Error("The API key could not be verified after saving");
    return { ok: true, key: data.key };
  });

/**
 * Verifies a SAVED key by decrypting it and asking the provider for its model
 * list. Proves the key survived encryption + storage and works right now.
 */
export const testProjectSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; key: string }) =>
    z.object({ projectId: z.string().uuid(), key: z.string().min(2) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { providerBaseUrlForKey } = await import("./chat-followups");
    const { data: row, error } = await supabaseAdmin
      .from("project_secrets")
      .select("value_encrypted")
      .eq("project_id", data.projectId)
      .eq("key", data.key)
      .maybeSingle();
    if (error || !row) return { ok: false, stored: false, error: "The key is not in storage yet" };
    let value = "";
    try {
      value = await decryptSecret(row.value_encrypted);
    } catch {
      return { ok: false, stored: true, error: "The key is stored but could not be decrypted" };
    }
    const baseUrl = providerBaseUrlForKey(data.key);
    if (!baseUrl) {
      return { ok: true, stored: true, tested: false, message: "Saved securely — ready to use." };
    }
    const { testProviderKey } = await import("./custom-providers.server");
    const result = await testProviderKey(baseUrl, value);
    return {
      ok: result.ok,
      stored: true,
      tested: true,
      modelCount: result.models?.length ?? 0,
      error: result.ok ? undefined : result.error,
    };
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
