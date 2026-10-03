// Cloudflare for SaaS: registers verified customer domains as Custom Hostnames on the
// admin's saved Cloudflare zone (Admin → Integrations → Cloudflare Domains), so Cloudflare
// issues SSL and forwards traffic to the fallback origin, which serves the live project.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "./secrets-crypto.server";

const FORGE_IP = "185.158.133.1";

async function loadSaasConfig() {
  const { data } = await supabaseAdmin
    .from("platform_integration_keys" as any)
    .select("field,value_encrypted")
    .eq("service", "cloudflare_dns");
  const v: Record<string, string> = {};
  for (const r of (data ?? []) as any[]) {
    try { v[r.field] = (await decryptSecret(r.value_encrypted)).trim(); } catch {}
  }
  if (!v.apiToken) throw new Error("Save your Cloudflare Domains key in Admin → Integrations first");
  if (!v.domain) throw new Error("Add your main domain on the Cloudflare Domains card first");
  return { token: v.apiToken.replace(/^Bearer\s+/i, ""), saasDomain: v.domain.toLowerCase() };
}

function client(token: string) {
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) {
      const msg = j?.errors?.[0]?.message ?? `HTTP ${res.status}`;
      const hint = res.status === 403 ? " (the token needs SSL and Certificates: Edit, Zone: Read and DNS: Edit)" : "";
      throw new Error(`Cloudflare said: ${msg}${hint}`);
    }
    return j.result;
  };
}

export type SaasResult = {
  hostname: string;
  status: string;
  sslStatus: string;
  cnameTarget: string;
  records: Array<{ type: string; name: string; value: string }>;
};

/** Create (or refresh) the Custom Hostname for `hostname`. Idempotent. */
export async function registerCustomHostname(hostname: string): Promise<SaasResult> {
  const { token, saasDomain } = await loadSaasConfig();
  const cf = client(token);
  const zones = await cf(`/zones?name=${encodeURIComponent(saasDomain)}`);
  const zone = zones?.[0];
  if (!zone) throw new Error(`Your Cloudflare key can't see ${saasDomain}`);

  // Fallback origin: a proxied record in your zone that points at the live-site server.
  const origin = `origin.${saasDomain}`;
  const existing = (await cf(`/zones/${zone.id}/dns_records?name=${origin}`)) as any[];
  if (!existing.length) {
    await cf(`/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "A", name: origin, content: FORGE_IP, proxied: true, ttl: 1 }),
    });
  }
  const fb = await cf(`/zones/${zone.id}/custom_hostnames/fallback_origin`).catch(() => null);
  if (!fb?.origin || fb.origin !== origin) {
    await cf(`/zones/${zone.id}/custom_hostnames/fallback_origin`, {
      method: "PUT",
      body: JSON.stringify({ origin }),
    });
  }

  const found = (await cf(`/zones/${zone.id}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`)) as any[];
  let ch = found?.[0];
  if (!ch) {
    ch = await cf(`/zones/${zone.id}/custom_hostnames`, {
      method: "POST",
      body: JSON.stringify({ hostname, ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } } }),
    });
  }

  const records: SaasResult["records"] = [{ type: "CNAME", name: hostname, value: origin }];
  if (ch.ownership_verification?.name)
    records.push({ type: "TXT", name: ch.ownership_verification.name, value: ch.ownership_verification.value });
  for (const r of ch.ssl?.validation_records ?? [])
    if (r.txt_name) records.push({ type: "TXT", name: r.txt_name, value: r.txt_value });

  return { hostname, status: ch.status, sslStatus: ch.ssl?.status ?? "unknown", cnameTarget: origin, records };
}

/** Save the SaaS status on the domain row so admins and owners can see it. */
export async function registerAndRecord(domainId: string, hostname: string) {
  try {
    const r = await registerCustomHostname(hostname);
    const live = r.status === "active" && r.sslStatus === "active";
    await supabaseAdmin
      .from("project_domains")
      .update({
        last_check_error: live
          ? null
          : `Cloudflare: hostname ${r.status}, SSL ${r.sslStatus}. Needed records: ` +
            r.records.map((x) => `${x.type} ${x.name} → ${x.value}`).join(" • "),
      })
      .eq("id", domainId);
    return { ok: true as const, ...r, live };
  } catch (e: any) {
    await supabaseAdmin.from("project_domains").update({ last_check_error: e?.message ?? "Cloudflare failed" }).eq("id", domainId);
    return { ok: false as const, message: e?.message ?? "Cloudflare failed" };
  }
}
