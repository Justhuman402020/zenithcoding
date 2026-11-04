import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { nextDomainStatus, normalizeHostname, STATUS_LABEL } from "./domain-policy";

/** Open the domain over https and confirm this project's published site answered. */
async function probeSite(host: string, projectId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (res.headers.get("x-code-haven-site") === projectId) return true;
    // A redirect to this project's primary domain still means routing works.
    return res.status >= 300 && res.status < 400 && !!res.headers.get("location");
  } catch {
    return false;
  }
}

async function dohLookup(name: string, type: "TXT" | "CNAME" | "A") {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
  const json = (await res.json()) as { Answer?: Array<{ data: string; type: number }> };
  return (json.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
}

/** Add a domain to a project and immediately prepare it on Cloudflare so the exact records can be shown. */
export const connectDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ projectId: z.string().uuid(), hostname: z.string().min(3).max(260) }).parse(data))
  .handler(async ({ data, context }) => {
    const host = normalizeHostname(data.hostname);
    if (!host) throw new Error("That isn't a full domain. Include the ending, like mysite.com or www.mysite.xyz.");
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("id").eq("id", data.projectId).maybeSingle();
    if (!project) throw new Error("Project not found");
    const { data: row, error } = await supabase
      .from("project_domains")
      .insert({ project_id: data.projectId, user_id: userId, hostname: host })
      .select("id")
      .single();
    if (error) throw new Error(error.message.includes("duplicate") ? "That domain is already connected" : error.message);
    const { registerAndRecord } = await import("./cloudflare-saas.server");
    const r = await registerAndRecord(row.id, host);
    return { id: row.id, hostname: host, ok: r.ok, message: r.ok ? null : r.message };
  });

export const verifyDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("project_domains")
      .select("id,hostname,verification_token,project_id,status,verified,consecutive_failures,first_failure_at")
      .eq("id", data.domainId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) throw new Error("Domain not found");
    const host = normalizeHostname(row.hostname);
    if (!host) {
      await supabase.from("project_domains").update({ status: "failed", last_check_error: "This isn't a full domain (it needs an ending like .com). Remove it and add the full name." }).eq("id", row.id);
      return { verified: false, live: false, status: "failed", message: "This domain name is incomplete" };
    }

    const checkedAt = new Date().toISOString();
    const txt = await dohLookup(`_forge-verify.${host}`, "TXT").catch((): string[] => []);
    const txtOk = txt.some((t) => t.trim() === row.verification_token);
    const aRecords = await dohLookup(host, "A").catch((): string[] => []);

    const { registerAndRecord } = await import("./cloudflare-saas.server");
    const cf = await registerAndRecord(row.id, host);
    const siteServes = await probeSite(host, row.project_id);
    const next = nextDomainStatus({
      prevStatus: row.status,
      everVerified: !!row.verified,
      txtOk,
      cfOk: cf.ok,
      cfStatus: cf.ok ? cf.status : null,
      sslStatus: cf.ok ? cf.sslStatus : null,
      siteServes,
      consecutiveFailures: row.consecutive_failures ?? 0,
      firstFailureAt: row.first_failure_at,
      now: checkedAt,
    });
    const status = next.status;

    const hints: string[] = [];
    if (status === "live" && !siteServes && next.consecutiveFailures > 0) hints.push("Last check had a problem, retrying.");
    if (!next.verified) hints.push(`TXT _forge-verify is missing (found: ${txt.join(", ") || "nothing"})`);
    if (aRecords.includes("185.158.133.1")) hints.push("An old A record pointing to 185.158.133.1 is still there. Delete it and add the CNAME instead.");
    if (!cf.ok) hints.push(cf.message);
    else if (status !== "live") {
      const missing = cf.records.filter((r) => r.type === "TXT").map((r) => `${r.type} ${r.name}`);
      if (cf.status !== "active" && missing.length) hints.push(`Cloudflare still needs: ${missing.join(", ")}`);
      if (cf.sslStatus !== "active") hints.push(`SSL: ${cf.sslStatus}`);
    }

    await supabase
      .from("project_domains")
      .update({
        status,
        verified: next.verified,
        ...(txtOk && !row.verified ? { verified_at: checkedAt } : {}),
        consecutive_failures: next.consecutiveFailures,
        first_failure_at: next.firstFailureAt,
        last_check_at: checkedAt,
        last_check_error: hints.length ? hints.join(" • ") : null,
      })
      .eq("id", row.id);

    return { verified: next.verified, live: status === "live", status, message: STATUS_LABEL[status] };
  });

/** Make one domain the main address; its www/root partner and other domains redirect to it. */
export const setPrimaryDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ domainId: z.string().uuid(), primary: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("project_domains")
      .select("id,project_id")
      .eq("id", data.domainId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) throw new Error("Domain not found");
    await supabase.from("project_domains").update({ is_primary: false }).eq("project_id", row.project_id);
    if (data.primary) await supabase.from("project_domains").update({ is_primary: true }).eq("id", row.id);
    return { ok: true };
  });
