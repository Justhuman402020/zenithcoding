// Cloudflare for SaaS: registers verified customer domains as Custom Hostnames on the
// admin's saved Cloudflare zone (Admin → Integrations → Cloudflare Domains), so Cloudflare
// issues SSL and forwards traffic to the fallback origin, which serves the live project.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "./secrets-crypto.server";

import { signHost } from "./domain-policy";
import { cloudflareDomainError } from "./cloudflare-domain-permissions";

// Placeholder origin: real traffic for customer domains is answered by the forwarder Worker.
const ORIGIN_PLACEHOLDER_IP = "192.0.2.1";
const WORKER_NAME = "code-haven-domains";

function appHost() {
  return (process.env.FORGE_APP_HOST || "boostallsocial.org").toLowerCase();
}

// Forwards every customer-domain request to Code Haven with a signed host header.
const WORKER_SOURCE = `
async function sign(secret, host) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(host.toLowerCase()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const target = new URL(url.pathname + url.search, "https://" + env.APP_HOST);
    const headers = new Headers(request.headers);
    headers.set("x-code-haven-host", host);
    headers.set("x-code-haven-sig", await sign(env.PROXY_SECRET, host));
    headers.delete("host");
    const init = { method: request.method, headers, redirect: "manual" };
    if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
    return fetch(target.toString(), init);
  },
};
`;

async function ensureWorker(cf: ReturnType<typeof client>, token: string, accountId: string) {
  const secret = process.env.DOMAIN_PROXY_SECRET;
  if (!secret) throw new Error("Domain forwarder secret is missing");
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({
      main_module: "worker.js",
      compatibility_date: "2025-01-01",
      bindings: [
        { type: "plain_text", name: "APP_HOST", text: appHost() },
        { type: "secret_text", name: "PROXY_SECRET", text: secret },
      ],
    })], { type: "application/json" }),
  );
  form.append("worker.js", new Blob([WORKER_SOURCE], { type: "application/javascript+module" }), "worker.js");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) {
    throw new Error(cloudflareDomainError(`/accounts/${accountId}/workers/scripts/${WORKER_NAME}`, res.status, j?.errors?.[0]?.message ?? `HTTP ${res.status}`));
  }
  void cf;
}

async function ensureRoute(cf: ReturnType<typeof client>, zoneId: string, hostname: string) {
  const pattern = `${hostname}/*`;
  const routes = (await cf(`/zones/${zoneId}/workers/routes`)) as any[];
  if (!routes.some((r) => r.pattern === pattern)) {
    await cf(`/zones/${zoneId}/workers/routes`, { method: "POST", body: JSON.stringify({ pattern, script: WORKER_NAME }) });
  }
}

/** Used by tests/diagnostics: the signature the forwarder will send for a host. */
export async function expectedSignature(host: string) {
  return signHost(process.env.DOMAIN_PROXY_SECRET ?? "", host);
}

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
      throw new Error(cloudflareDomainError(path, res.status, msg));
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
  if (!zone) throw new Error(`Your Cloudflare key can't see ${saasDomain}. Required permission: Zone Read (zone). Select this main domain under Zone Resources.`);
  if (!zone.account?.id) throw new Error(`Cloudflare did not return the account for ${saasDomain}. Select the account that owns this main domain under Account Resources with Workers Scripts Edit (account).`);

  // Fallback origin: a proxied record in your zone that points at the live-site server.
  const origin = `origin.${saasDomain}`;
  const existing = (await cf(`/zones/${zone.id}/dns_records?name=${origin}`)) as any[];
  if (!existing.length) {
    await cf(`/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "A", name: origin, content: ORIGIN_PLACEHOLDER_IP, proxied: true, ttl: 1 }),
    });
  }
  const fb = await cf(`/zones/${zone.id}/custom_hostnames/fallback_origin`);
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

  await ensureWorker(cf, token, zone.account?.id);
  await ensureRoute(cf, zone.id, hostname);

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
      .update({ ssl_status: r.sslStatus, dns_records: r.records as any })
      .eq("id", domainId);
    return { ok: true as const, ...r, live };
  } catch (e: any) {
    await supabaseAdmin.from("project_domains").update({ last_check_error: e?.message ?? "Cloudflare failed" }).eq("id", domainId);
    return { ok: false as const, message: e?.message ?? "Cloudflare failed" };
  }
}
