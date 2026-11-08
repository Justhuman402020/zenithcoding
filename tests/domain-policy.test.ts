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

import { nextDomainStatus as nds } from "../src/lib/domain-policy";
describe("sticky live domains", () => {
  const base = { prevStatus: "live", everVerified: true, txtOk: true, cfOk: true, cfStatus: "active", sslStatus: "active", siteServes: true, consecutiveFailures: 0, firstFailureAt: null, now: "2026-11-04T20:00:00Z" };
  it("live survives a single TXT miss", () => { expect(nds({ ...base, txtOk: false, siteServes: false }).status).toBe("live"); });
  it("live survives a Cloudflare error", () => { expect(nds({ ...base, cfOk: false, siteServes: false }).status).toBe("live"); });
  it("site answering means live", () => { expect(nds({ ...base, prevStatus: "verifying", everVerified: false, txtOk: false, cfOk: false, siteServes: true }).status).toBe("live"); });
  it("3 failures over 30 minutes goes offline", () => {
    expect(nds({ ...base, cfOk: false, siteServes: false, consecutiveFailures: 2, firstFailureAt: "2026-11-04T19:20:00Z" }).status).toBe("offline");
    expect(nds({ ...base, cfOk: false, siteServes: false, consecutiveFailures: 2, firstFailureAt: "2026-11-04T19:55:00Z" }).status).toBe("live");
  });
  it("ownership stays verified once proven", () => { expect(nds({ ...base, prevStatus: "verifying", txtOk: false, siteServes: false, cfStatus: "pending" }).verified).toBe(true); });
});
