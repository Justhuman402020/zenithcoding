import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";

const hostnameRe = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

export const FORGE_IP = "185.158.133.1";

async function doh(name: string, type: "A" | "CNAME" | "TXT") {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: "application/dns-json" } },
  );
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const json = (await res.json()) as { Answer?: Array<{ data: string }> };
  return (json.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/\.$/, ""));
}

/** Every project on the platform with its live-link status and connected domains. */
export const listProjectSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: projects, error } = await supabaseAdmin
      .from("projects")
      .select("id,name,slug,published,updated_at,user_id")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const ids = (projects ?? []).map((p) => p.id);
    const { data: domains } = ids.length
      ? await supabaseAdmin
          .from("project_domains")
          .select("id,project_id,hostname,verified,verification_token,last_check_error")
          .in("project_id", ids)
      : { data: [] as any[] };

    const byProject = new Map<string, any[]>();
    for (const d of domains ?? []) {
      const list = byProject.get(d.project_id as string) ?? [];
      list.push(d);
      byProject.set(d.project_id as string, list);
    }

    return (projects ?? []).map((p) => {
      const list = byProject.get(p.id) ?? [];
      const status: "published" | "pending" | "not_live" = p.published
        ? "published"
        : p.slug
          ? "pending"
          : "not_live";
      return { ...p, status, domains: list };
    });
  });

/** Publish / unpublish any project from the admin board. */
export const setProjectPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ projectId: z.string().uuid(), published: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("id,name,slug")
      .eq("id", data.projectId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found");

    let slug = project.slug;
    if (data.published && !slug) {
      const base =
        (project.name ?? "site")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 28) || "site";
      slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const { error: upErr } = await supabaseAdmin
      .from("projects")
      .update({ published: data.published, ...(slug ? { slug } : {}) })
      .eq("id", data.projectId);
    if (upErr) throw new Error(upErr.message);

    return { ok: true as const, published: data.published, slug };
  });

/** Connect a custom hostname to a project (admin side). */
export const attachDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ projectId: z.string().uuid(), hostname: z.string().min(3).max(253) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const host = data.hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!hostnameRe.test(host)) throw new Error("Enter a real domain like mysite.com");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id,user_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project) throw new Error("Project not found");

    const { error } = await supabaseAdmin
      .from("project_domains")
      .insert({ project_id: project.id, user_id: project.user_id, hostname: host });
    if (error)
      throw new Error(
        error.message.includes("duplicate") ? "That domain is already connected" : error.message,
      );
    return { ok: true as const, hostname: host };
  });

export const detachDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("project_domains").delete().eq("id", data.domainId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Live DNS lookup so the admin can see exactly what the domain points at right now. */
export const checkDomainDns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ hostname: z.string().min(3).max(253) }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const host = data.hostname.trim().toLowerCase();
    if (!hostnameRe.test(host)) throw new Error("Invalid hostname");

    const appHost = process.env.FORGE_APP_HOST || "zenithcoding.lovable.app";
    const [aRoot, aWww, cnameRoot, cnameWww, txt] = await Promise.all([
      doh(host, "A").catch((): string[] => []),
      doh(`www.${host}`, "A").catch((): string[] => []),
      doh(host, "CNAME").catch((): string[] => []),
      doh(`www.${host}`, "CNAME").catch((): string[] => []),
      doh(`_forge-verify.${host}`, "TXT").catch((): string[] => []),
    ]);

    const rootOk = aRoot.includes(FORGE_IP) || cnameRoot.some((c) => c.endsWith(appHost));
    const wwwOk = aWww.includes(FORGE_IP) || cnameWww.some((c) => c.endsWith(appHost));

    return {
      hostname: host,
      appHost,
      forgeIp: FORGE_IP,
      observed: { aRoot, aWww, cnameRoot, cnameWww, txt },
      rootOk,
      wwwOk,
      checkedAt: new Date().toISOString(),
    };
  });

/** Use the saved Cloudflare Domains key to write the DNS records for a connected domain. */
export const autoSetupDns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data: row } = await supabaseAdmin
      .from("project_domains")
      .select("id,hostname,verification_token")
      .eq("id", data.domainId)
      .maybeSingle();
    if (!row) throw new Error("Domain not found");
    const { data: keyRow } = await supabaseAdmin
      .from("platform_integration_keys" as any)
      .select("value_encrypted")
      .eq("service", "cloudflare_dns")
      .eq("field", "apiToken")
      .maybeSingle();
    if (!keyRow) throw new Error("Save your Cloudflare Domains key in Admin → Integrations first");
    const token = (await decryptSecret((keyRow as any).value_encrypted)).trim().replace(/^Bearer\s+/i, "");
    const cf = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(`Cloudflare said: ${j?.errors?.[0]?.message ?? res.status}`);
      return j.result;
    };
    const host = row.hostname.replace(/^www\./, "");
    const zones = await cf(`/zones?name=${encodeURIComponent(host)}`);
    const zone = zones?.[0];
    if (!zone) throw new Error(`Your Cloudflare key can't see ${host}`);
    const wanted = [
      { type: "A", name: host, content: FORGE_IP, proxied: false },
      { type: "A", name: `www.${host}`, content: FORGE_IP, proxied: false },
      { type: "TXT", name: `_forge-verify.${host}`, content: row.verification_token, proxied: false },
    ];
    for (const rec of wanted) {
      const existing = (await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(rec.name)}`)) as any[];
      // Remove records that would clash (other A/AAAA/CNAME on the same name, or old verify TXT).
      for (const e of existing) {
        const clash = rec.type === "A" ? ["A", "AAAA", "CNAME"].includes(e.type) : e.type === "TXT";
        if (clash && !(e.type === rec.type && e.content.replace(/^"|"$/g, "") === rec.content)) {
          await cf(`/zones/${zone.id}/dns_records/${e.id}`, { method: "DELETE" });
        }
      }
      const has = existing.some((e) => e.type === rec.type && e.content.replace(/^"|"$/g, "") === rec.content);
      if (!has) await cf(`/zones/${zone.id}/dns_records`, { method: "POST", body: JSON.stringify({ ...rec, ttl: 1 }) });
    }
    await supabaseAdmin
      .from("project_domains")
      .update({ verified: true, verified_at: new Date().toISOString(), last_check_error: null })
      .eq("id", row.id);
    const { registerAndRecord } = await import("./cloudflare-saas.server");
    await registerAndRecord(row.id, row.hostname).catch(() => null);
    return { ok: true as const, zone: zone.name };
  });

/** Register a domain on Cloudflare for SaaS (custom hostname + SSL). */
export const registerSaasHostname = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("project_domains").select("id,hostname").eq("id", data.domainId).maybeSingle();
    if (!row) throw new Error("Domain not found");
    const { registerAndRecord } = await import("./cloudflare-saas.server");
    const r = await registerAndRecord(row.id, row.hostname);
    if (!r.ok) throw new Error(r.message);
    return r;
  });
