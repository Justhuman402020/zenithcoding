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
    if (error) throw new Error(error.message.includes("duplicate") ? "That domain is already connected" : error.message);
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
      doh(host, "A").catch(() => []),
      doh(`www.${host}`, "A").catch(() => []),
      doh(host, "CNAME").catch(() => []),
      doh(`www.${host}`, "CNAME").catch(() => []),
      doh(`_forge-verify.${host}`, "TXT").catch(() => []),
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
