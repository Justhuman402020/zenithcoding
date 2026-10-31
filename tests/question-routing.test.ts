import { describe, it, expect } from "vitest";
import { detectFileChangeIntent } from "../src/lib/chat-agent.server";
describe("question routing", () => {
  it("knowledge questions are answered, not built", () => {
    expect(detectFileChangeIntent("Do you know how we'll make the chat section to be saving past chats ??")).toBe(false);
    expect(detectFileChangeIntent("How would we add login?")).toBe(false);
  });
  it("requests still build", () => {
    expect(detectFileChangeIntent("Can you fix the header?")).toBe(true);
    expect(detectFileChangeIntent("Make the chat save past chats")).toBe(true);
  });
});
