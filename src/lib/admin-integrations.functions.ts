// Admin-managed API keys for outside services (Unsplash, OpenRouter, Tavily,
// GitHub, E2B, Neon). Values are encrypted; the page only ever sees a masked copy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";
import { INTEGRATIONS } from "./integrations-catalog";

const serviceIds = INTEGRATIONS.map((s) => s.id) as [string, ...string[]];
const valuesSchema = z.object({
  service: z.enum(serviceIds),
  values: z.record(z.string(), z.string().max(4000)),
});

async function probe(service: string, v: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const call = async (url: string, headers: Record<string, string>, init: RequestInit = {}) => {
    const res = await fetch(url, { ...init, headers: { accept: "application/json", ...headers } });
    if (res.ok) return { ok: true, message: "Key works" };
    const text = await res.text().catch(() => "");
    return { ok: false, message: `${res.status}: ${text.slice(0, 160) || res.statusText || "rejected"}` };
  };
  try {
    switch (service) {
      case "unsplash":
        return await call("https://api.unsplash.com/photos?per_page=1", { Authorization: `Client-ID ${v.accessKey}`, "Accept-Version": "v1" });
      case "openrouter":
        return await call("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${v.apiKey}` });
      case "tavily": {
        const key = (v.apiKey || process.env["TAVILY_API_KEY"] || "").trim().replace(/^Bearer\s+/i, "");
        const r = await call("https://api.tavily.com/usage", { Authorization: `Bearer ${key}` });
        if (r.ok) return r;
        return await call(
          "https://api.tavily.com/search",
          { Authorization: `Bearer ${key}`, "content-type": "application/json" },
          { method: "POST", body: JSON.stringify({ api_key: key, query: "test", max_results: 1 }) },
        );
      }
      case "github":
        return await call("https://api.github.com/user", {
          Authorization: `Bearer ${v.token}`,
          "User-Agent": "forge-admin",
          "X-GitHub-Api-Version": "2022-11-28",
        });
      case "e2b":
        return await call("https://api.e2b.dev/sandboxes", { "X-API-Key": v.apiKey });
      case "neon":
        return await call("https://console.neon.tech/api/v2/users/me", { Authorization: `Bearer ${v.apiKey}` });
    }
    return { ok: false, message: "Unknown service" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not reach the service" };
  }
}

async function loadDecrypted(service: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { data } = await supabaseAdmin.from("platform_integration_keys" as any).select("field,value_encrypted").eq("service", service);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as any[]) {
    try {
      out[row.field] = await decryptSecret(row.value_encrypted);
    } catch {}
  }
  return out;
}

export const listIntegrationKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, maskValue } = await import("./secrets-crypto.server");
    const { data } = await supabaseAdmin.from("platform_integration_keys" as any).select("service,field,value_encrypted,updated_at");
    const saved: Record<string, Record<string, { masked: string; updatedAt: string }>> = {};
    for (const row of (data ?? []) as any[]) {
      let masked = "••••";
      try {
        masked = maskValue(await decryptSecret(row.value_encrypted));
      } catch {}
      (saved[row.service] ??= {})[row.field] = { masked, updatedAt: row.updated_at };
    }
    return { saved };
  });

export const testIntegrationKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => valuesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    // Blank fields fall back to the saved key, so saved keys can be re-tested.
    const saved = await loadDecrypted(data.service);
    const merged: Record<string, string> = { ...saved };
    for (const [k, val] of Object.entries(data.values)) if (val.trim()) merged[k] = val.trim();
    const def = INTEGRATIONS.find((s) => s.id === data.service)!;
    const primary = def.fields.find((f) => f.required)!;
    if (!merged[primary.key]) return { ok: false, message: `Enter the ${primary.label} first` };
    return probe(data.service, merged);
  });

export const saveIntegrationKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => valuesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const def = INTEGRATIONS.find((s) => s.id === data.service)!;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./secrets-crypto.server");
    const rows = [];
    for (const field of def.fields) {
      const val = (data.values[field.key] ?? "").trim();
      if (!val) continue;
      rows.push({
        service: data.service,
        field: field.key,
        value_encrypted: await encryptSecret(val),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length === 0) return { ok: false, message: "Nothing to save — paste a key first" };
    const { error } = await supabaseAdmin.from("platform_integration_keys" as any).upsert(rows as any);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Saved" };
  });

export const removeIntegrationKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ service: z.enum(serviceIds) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("platform_integration_keys" as any).delete().eq("service", data.service);
    return { ok: true };
  });
