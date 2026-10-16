import { describe, it, expect } from "vitest";
import { classifyAccess, isSelectable, summarizeByModel, newCatalogIds } from "../src/lib/model-access";

describe("model access labels (no provider calls)", () => {
  it("Cloudflare paid-only list is Paid only", () => {
    expect(classifyAccess({ model: "@cf/openai/gpt-oss-120b", cloudflare: true, lastStatus: null, lastError: null })).toBe("paid");
  });
  it("a payment error from a key makes it Paid only", () => {
    expect(classifyAccess({ model: "x", cloudflare: false, lastStatus: "unavailable", lastError: "402 Payment Required" })).toBe("paid");
  });
  it("a key error makes it Unavailable", () => {
    expect(classifyAccess({ model: "x", cloudflare: false, lastStatus: "unauthorized", lastError: "bad key" })).toBe("unavailable");
  });
  it("no errors means Free and selectable; others not selectable", () => {
    expect(classifyAccess({ model: "@cf/qwen/qwen3.8-27b", cloudflare: true, lastStatus: null, lastError: null })).toBe("free");
    expect(isSelectable("free")).toBe(true);
    expect(isSelectable("paid")).toBe(false);
    expect(isSelectable("unavailable")).toBe(false);
  });
  it("summary counts free, paid and error keys per model", () => {
    const [s] = summarizeByModel([
      { model: "m", keyId: "1", keyLabel: "#1", access: "free", error: null },
      { model: "m", keyId: "2", keyLabel: "#2", access: "paid", error: null },
      { model: "m", keyId: "3", keyLabel: "#3", access: "unavailable", error: "e" },
      { model: "m", keyId: "4", keyLabel: "#4", access: "free", error: null },
    ]);
    expect([s.free, s.paid, s.errors, s.keys.length]).toEqual([2, 1, 1, 4]);
  });
  it("New only after the first check", () => {
    expect(newCatalogIds(["a", "b"], [])).toEqual({ toInsert: ["a", "b"], markNew: false });
    expect(newCatalogIds(["a", "b"], ["a"])).toEqual({ toInsert: ["b"], markNew: true });
  });
});
