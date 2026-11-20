import { describe, expect, it } from "vitest";
import { replyTimeMs } from "./chat-timing";

const user = { role: "user", created_at: "2026-11-07T12:00:00.000Z" };

describe("side chat reply time", () => {
  it("uses the saved model reply time", () => {
    expect(replyTimeMs({ role: "assistant", created_at: "2026-11-07T12:05:00.000Z", parts: { reply_ms: 12_400 } }, user)).toBe(12_400);
  });
  it("falls back to the gap after the user's message for older replies", () => {
    expect(replyTimeMs({ role: "assistant", created_at: "2026-11-07T12:00:09.000Z" }, user)).toBe(9_000);
  });
  it("shows nothing when the reply doesn't follow a user message", () => {
    expect(replyTimeMs({ role: "assistant", created_at: "2026-11-07T12:00:09.000Z" }, null)).toBeNull();
    expect(replyTimeMs(user, null)).toBeNull();
  });
});
