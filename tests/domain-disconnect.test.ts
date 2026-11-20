import { describe, expect, it } from "vitest";
import { disconnectPlan, shouldServeDomain } from "@/lib/domain-policy";

const rows = [
  { hostname: "site.com", status: "live", project_id: "p1" },
  { hostname: "www.site.com", status: "disconnected", project_id: "p1" },
];

describe("domain disconnect", () => {
  it("does not serve a disconnected hostname", () => {
    expect(shouldServeDomain("www.site.com", rows)).toBeNull();
  });
  it("never lets a sibling www/root stand in for a removed name", () => {
    expect(shouldServeDomain("www.site.com", [rows[0]!])).toBeNull();
  });
  it("still serves the exact connected name", () => {
    expect(shouldServeDomain("site.com", rows)?.project_id).toBe("p1");
  });
  it("stops serving before cleaning Cloudflare and deleting", () => {
    expect(disconnectPlan([], "a.com").steps).toEqual(["mark_disconnected", "remove_custom_hostname", "remove_worker_route", "delete_row"]);
  });
  it("lists the ownership TXT among records to delete", () => {
    const r = disconnectPlan([{ type: "CNAME", name: "a.com", value: "origin.x.com" }], "a.com").recordsToDelete;
    expect(r.map((x) => x.name)).toEqual(["a.com", "_forge-verify.a.com"]);
  });
});
