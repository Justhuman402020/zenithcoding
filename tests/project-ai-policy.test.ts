import { describe, it, expect } from "vitest";
import { canEnable, siteChatDecision, nextDayCount, cleanMessages, SITE_CHAT_DAILY_CAP } from "@/lib/project-ai-policy";

describe("Use Cloudflare for this project", () => {
  it("won't turn on while the Cloudflare pool is off", () => {
    expect(canEnable(false).ok).toBe(false);
    expect(canEnable(true).ok).toBe(true);
  });
  it("switch off stops the site's AI right away", () => {
    expect(siteChatDecision({ enabled: false, poolEnabled: true, dayRequests: 0 })).toMatchObject({ ok: false, status: 403 });
  });
  it("pool off pauses site chat", () => {
    expect(siteChatDecision({ enabled: true, poolEnabled: false, dayRequests: 0 })).toMatchObject({ ok: false, status: 503 });
  });
  it("daily cap blocks extra requests", () => {
    expect(siteChatDecision({ enabled: true, poolEnabled: true, dayRequests: SITE_CHAT_DAILY_CAP })).toMatchObject({ ok: false, status: 429 });
    expect(siteChatDecision({ enabled: true, poolEnabled: true, dayRequests: 3 }).ok).toBe(true);
  });
  it("daily count resets on a new day", () => {
    expect(nextDayCount("2026-11-04", 40, "2026-11-05")).toBe(1);
    expect(nextDayCount("2026-11-05", 40, "2026-11-05")).toBe(41);
  });
  it("rejects messages without a user turn", () => {
    expect(cleanMessages([{ role: "system", content: "hi" }])).toBeNull();
    expect(cleanMessages([{ role: "user", content: "hi" }])).toHaveLength(1);
  });
});
