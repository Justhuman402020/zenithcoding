import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizeUrl(input: string) {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

async function probe(url: string, key: string, kind: "public" | "private") {
  const endpoint = kind === "private" ? `${url}/rest/v1/` : `${url}/auth/v1/settings`;
  try {
    const headers: Record<string, string> = { apikey: key, accept: "application/json" };
    if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
    const res = await fetch(endpoint, { headers });
    if (res.ok) return null;
    const text = await res.text().catch(() => "");
    return `${res.status}: ${text.slice(0, 160) || "rejected"}`;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not reach that address";
  }
}

const idInput = z.object({ projectId: z.string().uuid() });
const connInput = idInput.extend({
  projectUrl: z.string().min(8).max(300),
  anonKey: z.string().min(10).max(4000),
  serviceKey: z.string().max(4000).optional(),
});

export const getProjectBackend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { assertOwnsProject } = await import("./project-secrets.server");
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { loadProjectBackend } = await import("./project-backend.server");
    const b = await loadProjectBackend(data.projectId);
    return b ? { connected: true, url: b.url, hasServiceKey: b.hasServiceKey } : { connected: false, url: null, hasServiceKey: false };
  });

export const testProjectBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof connInput>) => connInput.parse(d))
  .handler(async ({ data }) => {
    const url = normalizeUrl(data.projectUrl);
    const e1 = await probe(url, data.anonKey.trim(), "public");
    if (e1) return { ok: false, error: `Public key failed — ${e1}` };
    if (data.serviceKey?.trim()) {
      const e2 = await probe(url, data.serviceKey.trim(), "private");
      if (e2) return { ok: false, error: `Private key failed — ${e2}` };
    }
    return { ok: true, error: null };
  });

export const saveProjectBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof connInput>) => connInput.parse(d))
  .handler(async ({ data, context }) => {
    const { assertOwnsProject } = await import("./project-secrets.server");
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const url = normalizeUrl(data.projectUrl);
    const err = await probe(url, data.anonKey.trim(), "public");
    if (err) throw new Error(`Connection test failed — ${err}`);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const rows = [
      { key: "VITE_SUPABASE_URL", value: url, expose_to_client: true, description: "Backend address for signup, login and data" },
      { key: "VITE_SUPABASE_ANON_KEY", value: data.anonKey.trim(), expose_to_client: true, description: "Public backend key used by the site" },
      ...(data.serviceKey?.trim()
        ? [{ key: "SUPABASE_SERVICE_ROLE_KEY", value: data.serviceKey.trim(), expose_to_client: false, description: "Private backend key (server only)" }]
        : []),
    ];
    for (const r of rows) {
      const { error } = await supabaseAdmin.from("project_secrets").upsert(
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
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Copies the admin-saved default backend into this project. */
export const useDefaultProjectBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { assertOwnsProject } = await import("./project-secrets.server");
    await assertOwnsProject(context.supabase, context.userId, data.projectId);
    const { seedPlatformBackend } = await import("./platform-backend.server");
    return { applied: await seedPlatformBackend(data.projectId, context.userId) };
  });
