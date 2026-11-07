/** Shared by domain setup guidance and endpoint-specific authorization errors. */
export const CLOUDFLARE_DOMAIN_PERMISSIONS = [
  { scope: "Zone", name: "Zone Read" },
  { scope: "Zone", name: "DNS Edit" },
  { scope: "Zone", name: "SSL and Certificates Edit" },
  { scope: "Zone", name: "Workers Routes Edit" },
  { scope: "Account", name: "Workers Scripts Edit" },
] as const;

export function domainPermissionForPath(path: string): string {
  if (/^\/accounts\/[^/]+\/workers\/scripts(?:\/|$)/.test(path)) return "Workers Scripts Edit (account)";
  if (/^\/zones\/[^/]+\/workers\/routes(?:\/|$)/.test(path)) return "Workers Routes Edit (zone)";
  if (/^\/zones\/[^/]+\/custom_hostnames(?:\/|$)/.test(path)) return "SSL and Certificates Edit (zone)";
  if (/^\/zones\/[^/]+\/dns_records(?:\/|$)/.test(path)) return "DNS Edit (zone)";
  return "Zone Read (zone)";
}

export function cloudflareDomainError(path: string, status: number, detail: string): string {
  const permission = domainPermissionForPath(path);
  const hint = status === 403
    ? ` Required permission: ${permission}. Check that your token includes this permission and covers ${permission.includes("(account)") ? "the account that owns your main domain" : "the zone for this domain"}. Cloudflare may also restrict the token by IP address or expiry.`
    : "";
  return `Cloudflare said (HTTP ${status}): ${detail}${hint}`;
}