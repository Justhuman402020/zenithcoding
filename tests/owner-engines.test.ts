import { describe, expect, it } from "vitest";
import { isOwner, engineFor, ACCOUNT_ALLOWANCE, ACCOUNT_COUNT, ACCOUNT_GUARD, successfulEdit, sectionTotals } from "../src/lib/owner-policy";
describe("owner and approved engines", () => {
  it("permits only the verified owner", () => {
    expect(isOwner({ email: "justsamsung99@gmail.com", email_confirmed_at: "2026-10-25" })).toBe(true);
    expect(isOwner({ email: "other@example.com", email_confirmed_at: "2026-10-25" })).toBe(false);
    expect(isOwner({ email: "justsamsung99@gmail.com" })).toBe(false);
  });
  it("planning never uses OpenRouter", () => expect(engineFor("plan", "openrouter")).toBe("cloudflare"));
  it("new builds default to the chosen engine", () => expect(engineFor("build", "openrouter")).toBe("openrouter"));
  it("running builds preserve their engine after a switch", () => expect(engineFor("build", "cloudflare", "openrouter")).toBe("openrouter"));
  it("shows the 600k allowance separately from the 9500 guard", () => {
    expect(ACCOUNT_ALLOWANCE * ACCOUNT_COUNT).toBe(600000);
    expect(ACCOUNT_GUARD).toBe(9500);
  });
  it("does not publish partial or failed attempts", () => {
    expect(successfulEdit({ status: "failed", outcome: "finished" })).toBe(false);
    expect(successfulEdit({ status: "completed", outcome: "incomplete" })).toBe(false);
    expect(successfulEdit({ status: "completed", outcome: "finished" })).toBe(true);
  });
  it("separates planning and chat usage", () => expect(sectionTotals([{ section: "chat", neurons: 12 }, { section: "plan", neurons: 23 }])).toEqual({ chat: 12, plan: 23, build: 0 }));
});