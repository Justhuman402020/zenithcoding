import { describe, expect, it } from "vitest";
import { authIdentityChanged, isWorkspaceAccessDenied } from "../src/lib/session-policy";
import { isOwner } from "../src/lib/owner-policy";

describe("persistent owner access", () => {
  it("does not restart admission on waking the same signed-in account", () => {
    expect(authIdentityChanged("owner-id", "owner-id")).toBe(false);
    expect(authIdentityChanged("owner-id", null)).toBe(true);
    expect(authIdentityChanged(null, "owner-id")).toBe(true);
  });
  it("keeps the owner signed in when a connection or service check fails", () => {
    for (const error of [new TypeError("Failed to fetch"), new Error("Network request failed"), new Error("Service unavailable")]) {
      expect(isWorkspaceAccessDenied(error)).toBe(false);
    }
  });
  it("honors an explicit server denial, including device revocation", () => {
    expect(isWorkspaceAccessDenied(new Error("Not available"))).toBe(true);
  });
  it("allows only justsamsung99@gmail.com after email verification", () => {
    expect(isOwner({ email: "justsamsung99@gmail.com", email_confirmed_at: "2026-10-25" })).toBe(true);
    expect(isOwner({ email: "someone@gmail.com", email_confirmed_at: "2026-10-25" })).toBe(false);
    expect(isOwner({ email: "justsamsung99@gmail.com" })).toBe(false);
  });
});