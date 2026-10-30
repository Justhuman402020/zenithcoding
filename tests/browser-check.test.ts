import { describe, expect, it } from "vitest";
import { cleanFindings, injectReporter, MAX_FIX_ROUNDS, nextFixRound, PREVIEW_TOKEN_MAX_USES, PREVIEW_TOKEN_TTL_MS, redactSecrets, tokenUsable } from "@/lib/browser-check-policy";

describe("browser test rules", () => {
  it("test address lasts 15 minutes", () => {
    expect(PREVIEW_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    const now = Date.now();
    expect(tokenUsable({ expires_at: new Date(now + 1000).toISOString(), uses: 0 }, now)).toBe(true);
    expect(tokenUsable({ expires_at: new Date(now - 1).toISOString(), uses: 0 }, now)).toBe(false);
  });
  it("test address stops after its allowed loads", () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(tokenUsable({ expires_at: later, uses: PREVIEW_TOKEN_MAX_USES }, Date.now())).toBe(false);
  });
  it("allows at most 3 fix rounds, then stops with a reason", () => {
    expect(MAX_FIX_ROUNDS).toBe(3);
    expect(nextFixRound(2).allowed).toBe(true);
    const stop = nextFixRound(3);
    expect(stop.allowed).toBe(false);
    expect(stop.reason).toMatch(/3 fix rounds/);
  });
  it("hides keys and passwords in findings", () => {
    const out = redactSecrets("failed https://x.dev/a?api_key=abc123&ok=1 and sk-or-v1-abcdefghijklmnop");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("sk-or-v1-abcdefghijklmnop");
    expect(cleanFindings({ pageErrors: ["password=hunter2"] }).pageErrors[0]).not.toContain("hunter2");
  });
  it("puts the reporter first in the page head", () => {
    expect(injectReporter("<html><head><title>x</title></head></html>")).toMatch(/^<html><head><script>/);
  });
});
