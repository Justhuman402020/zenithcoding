import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";

export const getAdminBrain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { loadAdminBrain, listVault } = await import("./admin-vault.server");
    const [content, vault] = await Promise.all([loadAdminBrain(), listVault()]);
    return { content, vault };
  });

export const saveAdminBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { content: string }) => z.object({ content: z.string().max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("admin_brain")
      .upsert({ id: "global", content: data.content, updated_at: new Date().toISOString(), updated_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const credSchema = z.object({
  label: z.string().trim().min(2).max(80),
  kind: z.enum(["key", "key_id", "url_key"]),
  key: z.string().trim().min(4).max(8000),
  baseUrl: z.string().trim().max(500).optional(),
  accountId: z.string().trim().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export const saveCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof credSchema>) => credSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const { error } = await supabaseAdmin.from("admin_credentials").insert({
      label: data.label,
      kind: data.kind,
      base_url: data.baseUrl || null,
      account_id: data.accountId || null,
      notes: data.notes || null,
      key_encrypted: await encryptSecret(data.key),
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_credentials").delete().eq("id", data.id);
    return { ok: true };
  });

function resolveBase(kind: string, baseUrl?: string | null, accountId?: string | null, label?: string) {
  if (baseUrl) return baseUrl;
  if (accountId) return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  const l = (label ?? "").toLowerCase();
  if (/google|gemini|studio/.test(l)) return "https://generativelanguage.googleapis.com/v1beta/openai";
  if (/groq/.test(l)) return "https://api.groq.com/openai/v1";
  if (/cerebras/.test(l)) return "https://api.cerebras.ai/v1";
  if (/openrouter/.test(l)) return "https://openrouter.ai/api/v1";
  if (/mistral/.test(l)) return "https://api.mistral.ai/v1";
  if (/deepinfra/.test(l)) return "https://api.deepinfra.com/v1/openai";
  return null;
}

/** Test & Scan Models: hits the provider's /models endpoint. Optionally imports it as a model provider. */
export const scanCredentialModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; importProvider?: boolean }) =>
    z.object({ id: z.string().uuid(), importProvider: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, encryptSecret } = await import("./secrets-crypto.server");
    const { data: row } = await supabaseAdmin.from("admin_credentials").select("*").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Credential not found");
    const base = resolveBase(row.kind, row.base_url, row.account_id, row.label);
    if (!base) return { ok: false, error: "Add a Base URL (or ID) so I know where to scan.", models: [] as string[], modelCount: 0, imported: false };
    const { normalizeBaseUrl, listModelIds, slugifyProviderId } = await import("./custom-providers.server");
    const baseUrl = normalizeBaseUrl(base);
    const key = await decryptSecret(row.key_encrypted);
    const r = await listModelIds(baseUrl, key);
    let imported = false;
    if (r.ok && data.importProvider) {
      const { error } = await supabaseAdmin.from("custom_ai_providers").insert({
        id: `${slugifyProviderId(row.label)}-${crypto.randomUUID().slice(0, 8)}`,
        label: row.label,
        base_url: baseUrl,
        key_encrypted: await encryptSecret(key),
        created_by: context.userId,
        updated_at: new Date().toISOString(),
      } as any);
      if (error) throw new Error(error.message);
      const { clearModelDiscoveryCache } = await import("./model-discovery.server");
      clearModelDiscoveryCache();
      imported = true;
    }
    return { ok: r.ok, error: r.error, models: r.models.slice(0, 80), modelCount: r.models.length, imported };
  });

// ---------- Structured brain notes (stored as JSON in admin_brain row "notes") ----------
const noteSchema = z.object({
  id: z.string().min(1).max(64),
  category: z.string().trim().max(60),
  purpose: z.string().trim().max(200),
  body: z.string().max(8000),
});
export type BrainNote = z.infer<typeof noteSchema>;

export const saveBrainNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { notes: BrainNote[] }) => z.object({ notes: z.array(noteSchema).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("admin_brain")
      .upsert({ id: "notes", content: JSON.stringify(data.notes), updated_at: new Date().toISOString(), updated_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getBrainNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { loadBrainNotes } = await import("./admin-vault.server");
    return { notes: await loadBrainNotes() };
  });

// ---------- Vault: reveal / update ----------
export const revealCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data: row } = await supabaseAdmin.from("admin_credentials").select("key_encrypted").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Credential not found");
    return { key: await decryptSecret(row.key_encrypted) };
  });

export const updateCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; label?: string; key?: string; baseUrl?: string; accountId?: string; notes?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().trim().min(2).max(80).optional(),
        key: z.string().trim().min(4).max(8000).optional(),
        baseUrl: z.string().trim().max(500).optional(),
        accountId: z.string().trim().max(200).optional(),
        notes: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.label !== undefined) patch.label = data.label;
    if (data.baseUrl !== undefined) patch.base_url = data.baseUrl || null;
    if (data.accountId !== undefined) patch.account_id = data.accountId || null;
    if (data.notes !== undefined) patch.notes = data.notes || null;
    if (data.key) {
      const { encryptSecret } = await import("./secrets-crypto.server");
      patch.key_encrypted = await encryptSecret(data.key);
    }
    const { error } = await supabaseAdmin.from("admin_credentials").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
