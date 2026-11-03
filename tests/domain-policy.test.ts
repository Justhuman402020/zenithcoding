import { describe, expect, it } from "vitest";
import { domainStatus, normalizeHostname, pageForPath, signHost, verifyHostSignature } from "../src/lib/domain-policy";

describe("domain policy", () => {
  it("rejects names without an ending", () => {
    expect(normalizeHostname("www.wizzcoding")).toBeNull();
    expect(normalizeHostname("https://ZenithVideioAI.xyz/")).toBe("zenithvideioai.xyz");
  });

  it("is live only when ownership, hostname and SSL are all active", () => {
    expect(domainStatus({ txtOk: true, cfStatus: "active", sslStatus: "active" })).toBe("live");
    expect(domainStatus({ txtOk: false, cfStatus: "active", sslStatus: "active" })).toBe("waiting_records");
    expect(domainStatus({ txtOk: true, cfStatus: "active", sslStatus: "pending_validation" })).toBe("setting_up_ssl");
    expect(domainStatus({ txtOk: true, cfStatus: "pending", sslStatus: "pending_validation" })).toBe("verifying");
  });

  it("accepts only the forwarder's signature for that host", async () => {
    const sig = await signHost("s3cret", "www.example.com");
    expect(await verifyHostSignature("s3cret", "www.example.com", sig)).toBe(true);
    expect(await verifyHostSignature("s3cret", "evil.com", sig)).toBe(false);
    expect(await verifyHostSignature(undefined, "www.example.com", sig)).toBe(false);
  });

  it("maps visitor paths to project pages", () => {
    expect(pageForPath("/")).toBe("index.html");
    expect(pageForPath("/about")).toBe("about.html");
    expect(pageForPath("/forge-sdk.js")).toBeNull();
  });
});
