import { describe, expect, it } from "vitest";
import { cloudflareDomainError, domainPermissionForPath } from "../src/lib/cloudflare-domain-permissions";

describe("Cloudflare domain authorization requirements", () => {
  it.each([
    ["/zones?name=example.org", "Zone Read (zone)"],
    ["/zones/zone/dns_records", "DNS Edit (zone)"],
    ["/zones/zone/dns_records/record", "DNS Edit (zone)"],
    ["/zones/zone/custom_hostnames", "SSL and Certificates Edit (zone)"],
    ["/zones/zone/custom_hostnames/fallback_origin", "SSL and Certificates Edit (zone)"],
    ["/zones/zone/workers/routes", "Workers Routes Edit (zone)"],
    ["/accounts/account/workers/scripts/code-haven-domains", "Workers Scripts Edit (account)"],
  ])("maps %s to its required permission", (path, permission) => {
    expect(domainPermissionForPath(path)).toBe(permission);
    const error = cloudflareDomainError(path, 403, "Access denied");
    expect(error).toContain(`Required permission: ${permission}`);
    expect(error).toContain("HTTP 403");
    expect(error).toContain("Access denied");
  });

  it("does not blame permissions for non-authorization errors", () => {
    expect(cloudflareDomainError("/zones/z/dns_records", 429, "Rate limited"))
      .toBe("Cloudflare said (HTTP 429): Rate limited");
  });
});