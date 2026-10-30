import { describe, it, expect } from "vitest";
import { allowedScrolltideOrigin, isScrolltideLookup, mayApproveDraft, SCROLLTIDE_ITEM_ALLOWANCE, templateBuildText } from "../src/lib/runtime-mcp/scrolltide-policy";
import { recoveryHeaders } from "../src/lib/build-recovery";
import { canUseTemplateDraft, validOAuthReturn } from "../src/lib/runtime-mcp/oauth-policy";
describe("Scrolltide integration safeguards", () => {
  it("rejects expired or malformed approval returns", () => {
    expect(validOAuthReturn("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "code", "2026-10-30T03:00:00Z", Date.parse("2026-10-30T02:00:00Z"))).toBe(true);
    expect(validOAuthReturn("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "code", "2026-10-30T01:00:00Z", Date.parse("2026-10-30T02:00:00Z"))).toBe(false);
    expect(validOAuthReturn("bad", "code", "2026-10-30T03:00:00Z", Date.parse("2026-10-30T02:00:00Z"))).toBe(false);
  });
  it("requires the owning project and matching job for a resumed draft", () => {
    const draft = { state: "dispatched", user_id: "owner", project_id: "project", request_key: "job" };
    expect(canUseTemplateDraft(draft, "owner", "project", "job", true)).toBe(true);
    expect(canUseTemplateDraft(draft, "other", "project", "job", true)).toBe(false);
    expect(canUseTemplateDraft(draft, "owner", "project", "other-job", true)).toBe(false);
    expect(canUseTemplateDraft(draft, "owner", "project", "job", false)).toBe(false);
  });
  it("only accepts known connection return origins", () => {
    expect(allowedScrolltideOrigin("https://boostallsocial.org/admin")).toBe("https://boostallsocial.org");
    expect(() => allowedScrolltideOrigin("https://boostallsocial.org.attacker.example")).toThrow();
  });
  it("template lookup is not a build request", () => {
    expect(isScrolltideLookup("Find Scrolltide portfolio templates")).toBe(true);
    expect(isScrolltideLookup("Build the approved Scrolltide template")).toBe(false);
  });
  it("denial never authorizes a draft", () => { expect(mayApproveDraft("draft", false)).toBe(false); expect(mayApproveDraft("draft", true)).toBe(true); expect(mayApproveDraft("dispatched", true)).toBe(false); });
  it("preserves approved draft identity and model in durable recovery", () => {
    expect(recoveryHeaders(new Headers({ "x-forge-scrolltide-draft": "draft-123", "x-forge-model": "openrouter:chosen" }))).toMatchObject({ "x-forge-scrolltide-draft": "draft-123", "x-forge-model": "openrouter:chosen" });
  });
  it("carries the exact fetched brief and owner requirements", () => {
    const text = templateBuildText("Portfolio", "Use a two-column project grid", "Keep my logo");
    expect(text).toContain("Use a two-column project grid"); expect(text).toContain("Keep my logo");
  });
  it("uses Scrolltide's published 40-item allowance without guessing remaining usage", () => { expect(SCROLLTIDE_ITEM_ALLOWANCE).toBe(40); });
});