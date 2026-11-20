import { describe, it, expect, vi } from "vitest";
import * as P from "../src/lib/cf-pool-policy";

const keys = Array.from({ length: 65 }, (_, i) => ({ position: 65 - i, id: `k${65 - i}` }));

describe("pool order", () => {
  it("runs 1 to 60 in strict order", () => {
    const o = P.orderPool(keys);
    expect(o.length).toBe(60);
    expect(o.map((k) => k.position)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });
  it("never skips an unused key", () => expect(P.nextKey(P.orderPool(keys), 4)?.position).toBe(5));
  it("stops after key 60", () => expect(P.nextKey(P.orderPool(keys), 60)).toBeNull());
});

describe("errors", () => {
  it("a bare 429 is not quota", () => expect(P.classifyError(429, "Too Many Requests")).toBe("rate_limit"));
  it("daily allocation error is quota", () =>
    expect(P.classifyError(429, "you have used up your daily free allocation of 10,000 neurons")).toBe("quota"));
  it("quota moves to the next key", () => expect(P.onKeyError("quota", 0)).toEqual({ action: "next_key" }));
  it("rate limit retries the same key 3 times 60s apart, then pauses", () => {
    expect(P.onKeyError("rate_limit", 0)).toEqual({ action: "retry", delayMs: 60_000, attempt: 1 });
    expect(P.onKeyError("rate_limit", 2)).toEqual({ action: "retry", delayMs: 60_000, attempt: 3 });
    expect(P.onKeyError("rate_limit", 3)).toEqual({ action: "pause" });
  });
  it("other errors pause for Retry / Approve", () => expect(P.onKeyError("other", 0)).toEqual({ action: "pause" }));
});

describe("budget", () => {
  it("hands off at 9,000", () => {
    expect(P.shouldHandOffAt(8999)).toBe(false);
    expect(P.shouldHandOffAt(9000)).toBe(true);
  });
  it("preflight blocks a call that would pass 9,500", () => {
    expect(P.preflightAllowed(9000, 500)).toBe(true);
    expect(P.preflightAllowed(9000, 501)).toBe(false);
  });
});

describe("per-run cap", () => {
  it("off means no cap", () => expect(P.validateRunCap(false, 0, null)).toEqual({ ok: true, cap: null }));
  it("on with 0 or blank won't run", () => {
    expect(P.validateRunCap(true, 0, null).ok).toBe(false);
    expect(P.validateRunCap(true, null, null).ok).toBe(false);
  });
  it("can't exceed today's remaining", () => expect(P.validateRunCap(true, 5000, 4000).ok).toBe(false));
  it("accepts a valid cap", () => expect(P.validateRunCap(true, 3000, 4000)).toEqual({ ok: true, cap: 3000 }));
  const base = { runUsed: 0, cap: 1000, poolEnabled: true, userStopped: false, taskDone: false, atLastKey: false };
  it("stops at the cap", () => expect(P.runStopReason({ ...base, runUsed: 1000 })).toBe("cap"));
  it("stops when toggled off", () => expect(P.runStopReason({ ...base, poolEnabled: false })).toBe("toggle_off"));
  it("stops on Stop", () => expect(P.runStopReason({ ...base, userStopped: true })).toBe("stopped"));
  it("stops on completion", () => expect(P.runStopReason({ ...base, taskDone: true })).toBe("done"));
  it("stops at key 60", () => expect(P.runStopReason({ ...base, atLastKey: true })).toBe("last_key"));
  it("keeps going otherwise", () => expect(P.runStopReason({ ...base, runUsed: 999 })).toBeNull());
});

describe("counting", () => {
  it("uses Cloudflare's number when readable", () =>
    expect(P.countCall({ model: "x", real: 1234, inputTokens: 1, outputTokens: 1 })).toEqual({ neurons: 1234, source: "cloudflare" }));
  it("estimates from tokens × per-model rate", () =>
    expect(P.countCall({ model: "@cf/qwen/qwen2.5-coder-32b-instruct", inputTokens: 1_000_000, outputTokens: 0 })).toEqual({ neurons: 60_000, source: "estimate" }));
  it("counts a failed call that used tokens", () =>
    expect(P.countCall({ model: "@cf/qwen/qwq-32b", inputTokens: 10_000, outputTokens: 0 }).neurons).toBe(600));
  it("falls back to a conservative character estimate labeled uncertain", () => {
    const c = P.countCall({ model: "@cf/qwen/qwq-32b", chars: 3000 });
    expect(c.source).toBe("uncertain");
    expect(c.neurons).toBe(Math.ceil((1000 * 90_909) / 1_000_000));
  });
  it("daily totals reset at 00:00 UTC (01:00 Lagos)", () => {
    expect(P.utcDayOf(new Date("2026-10-14T23:59:59Z"))).toBe("2026-10-14");
    expect(P.utcDayOf(new Date("2026-10-15T00:00:00Z"))).toBe("2026-10-15");
    expect(P.lagosTime(new Date("2026-10-15T00:00:00Z"))).toContain("01:00:00");
  });
});

describe("ledger and handoff", () => {
  it("ledger carries every field", () => {
    const e = P.ledgerEntry({ key: 4, filesDone: ["a.tsx"], neuronsThisTurn: 900, totalAtHandoff: 9000, source: "estimate", reason: "handoff at 9,000", successor: 5, retries: 0, at: new Date("2026-10-14T12:00:00Z") });
    expect(e.remaining).toBe(0);
    expect(e.successor).toBe(5);
    expect(e.lagos).toContain("13:00:00");
    expect(e.asOf).toBe("2026-10-14T12:00:00.000Z");
  });
  it("note has files, remaining, last error, next action, queue position", () => {
    const n = P.handoffNote({ completed: ["a.tsx"], remaining: "item 8", lastError: "429", next: "finish item 8", position: 5 });
    for (const s of ["a.tsx", "item 8", "429", "finish item 8", "key #5 of 60"]) expect(n).toContain(s);
  });
});

describe("saves", () => {
  it("saves complete valid files", () => expect(P.validateFile("a.tsx", "export const A = () => <div>{1}</div>;\n")).toEqual({ ok: true }));
  it("rejects cut-off code", () => expect(P.validateFile("a.tsx", "export function A() {\n  return (<div>")).toMatchObject({ ok: false }));
  it("rejects placeholder partials", () => expect(P.validateFile("a.ts", "const a = 1;\n// ... rest of code\n")).toMatchObject({ ok: false }));
  it("rejects invalid JSON", () => expect(P.validateFile("p.json", "{")).toMatchObject({ ok: false }));
  it("allows 3 repairs then pauses", () => {
    expect([1, 2, 3].map(P.repairDecision)).toEqual(["repair", "repair", "repair"]);
    expect(P.repairDecision(4)).toBe("pause");
  });
});

describe("pool OFF makes zero Cloudflare calls", () => {
  it("vision and coding chains drop Cloudflare providers", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { withoutCloudflare } = await import("../src/lib/cf-pool-routing");
    const providers = [
      { id: "groq", baseURL: "https://api.groq.com/openai/v1" },
      { id: "custom-1", baseURL: "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1" },
    ];
    expect(withoutCloudflare(providers).map((p) => p.id)).toEqual(["groq"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
