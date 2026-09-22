// Admin-managed Supabase connection used as the default backend for every new project.
// The admin pastes the project URL + keys once, tests them, and saves. New projects
// then receive those credentials automatically as project secrets, so generated apps
// can do signup / login / data storage out of the box.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";

const CONNECTION_ID = "global";

function normalizeUrl(input: string) {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/**
 * Checks a project address + key.
 * Public keys are checked against the auth settings endpoint (the REST root now
 * only answers to private keys). Private keys are checked against the REST root.
 */
async function probe(url: string, key: string, kind: "public" | "private" = "public") {
  const endpoint = kind === "private" ? `${url}/rest/v1/` : `${url}/auth/v1/settings`;
  try {
    const headers: Record<string, string> = { apikey: key, accept: "application/json" };
    // New-style opaque keys (sb_...) are not JWTs — sending them as a bearer token is rejected.
    if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
    const res = await fetch(endpoint, { headers });

    if (res.ok) return { ok: true as const, error: null };
    const text = await res.text().catch(() => "");
    return { ok: false as const, error: `${res.status}: ${text.slice(0, 160) || "rejected"}` };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not reach that address" };
  }
}


export const getSupabaseConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, maskValue } = await import("./secrets-crypto.server");
    const { data } = await supabaseAdmin
      .from("platform_supabase_connection")
      .select("project_url, anon_key_encrypted, service_key_encrypted, label, updated_at")
      .eq("id", CONNECTION_ID)
      .maybeSingle();
    if (!data) return { connection: null };
    let anonMasked = "";
    let hasServiceKey = false;
    try {
      anonMasked = maskValue(await decryptSecret(data.anon_key_encrypted as string));
    } catch {
      anonMasked = "••••";
    }
    if (data.service_key_encrypted) hasServiceKey = true;
    return {
      connection: {
        projectUrl: data.project_url as string,
        label: (data.label as string | null) ?? null,
        anonMasked,
        hasServiceKey,
        updatedAt: data.updated_at as string,
      },
    };
  });

const connectionInput = z.object({
  projectUrl: z.string().min(8).max(300),
  anonKey: z.string().min(10).max(4000),
  serviceKey: z.string().max(4000).optional(),
  label: z.string().max(80).optional(),
});

export const testSupabaseConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const url = normalizeUrl(data.projectUrl);
    const anon = await probe(url, data.anonKey.trim());
    if (!anon.ok) return { ok: false, error: `Public key failed — ${anon.error}`, serviceOk: false };
    let serviceOk = false;
    if (data.serviceKey?.trim()) {
      const svc = await probe(url, data.serviceKey.trim());
      if (!svc.ok) return { ok: false, error: `Private key failed — ${svc.error}`, serviceOk: false };
      serviceOk = true;
    }
    return { ok: true, error: null, serviceOk };
  });

export const saveSupabaseConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => connectionInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const url = normalizeUrl(data.projectUrl);
    const anon = await probe(url, data.anonKey.trim());
    if (!anon.ok) throw new Error(`Connection test failed — ${anon.error}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const { error } = await supabaseAdmin.from("platform_supabase_connection").upsert(
      {
        id: CONNECTION_ID,
        project_url: url,
        anon_key_encrypted: await encryptSecret(data.anonKey.trim()),
        service_key_encrypted: data.serviceKey?.trim() ? await encryptSecret(data.serviceKey.trim()) : null,
        label: data.label?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeSupabaseConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("platform_supabase_connection")
      .delete()
      .eq("id", CONNECTION_ID);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Copies the saved backend credentials into a freshly created project. */
export const applyPlatformBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertOwnsProject } = await import("./project-secrets.server");
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, encryptSecret } = await import("./secrets-crypto.server");
    const { data: row } = await supabaseAdmin
      .from("platform_supabase_connection")
      .select("project_url, anon_key_encrypted, service_key_encrypted")
      .eq("id", CONNECTION_ID)
      .maybeSingle();
    if (!row) return { applied: false };

    let anonKey = "";
    try {
      anonKey = await decryptSecret(row.anon_key_encrypted as string);
    } catch {
      return { applied: false };
    }
    let serviceKey: string | null = null;
    if (row.service_key_encrypted) {
      try {
        serviceKey = await decryptSecret(row.service_key_encrypted as string);
      } catch {
        serviceKey = null;
      }
    }

    const rows = [
      {
        key: "VITE_SUPABASE_URL",
        value: row.project_url as string,
        expose_to_client: true,
        description: "Backend address for signup, login and data",
      },
      {
        key: "VITE_SUPABASE_ANON_KEY",
        value: anonKey,
        expose_to_client: true,
        description: "Public backend key used by the site",
      },
      ...(serviceKey
        ? [
            {
              key: "SUPABASE_SERVICE_ROLE_KEY",
              value: serviceKey,
              expose_to_client: false,
              description: "Private backend key (server only)",
            },
          ]
        : []),
    ];

    for (const r of rows) {
      await supabaseAdmin.from("project_secrets").upsert(
        {
          project_id: data.projectId,
          user_id: context.userId,
          key: r.key,
          value_encrypted: await encryptSecret(r.value),
          expose_to_client: r.expose_to_client,
          description: r.description,
        },
        { onConflict: "project_id,key" },
      );
    }
    return { applied: true };
  });
