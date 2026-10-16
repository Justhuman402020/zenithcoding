import { describe, it, expect } from "vitest";
import { isCloudflareUrl, assertChatUrlAllowed, parseEditProposal, canStartBuild, decide, ASSISTANT_CAPABILITIES } from "../src/lib/assistant-policy";

describe("chat helper rules", () => {
  it("refuses Cloudflare addresses", () => {
    expect(isCloudflareUrl("https://api.cloudflare.com/client/v4/accounts/x/ai/v1")).toBe(true);
    expect(() => assertChatUrlAllowed("https://api.cloudflare.com/x")).toThrow();
    expect(isCloudflareUrl("https://ollama.com")).toBe(false);
  });
  it("a proposed edit never starts a build until approved", () => {
    expect(canStartBuild("pending")).toBe(false);
    expect(canStartBuild(decide("pending", "yes"))).toBe(true);
  });
  it("declined edits never start a build", () => {
    expect(canStartBuild(decide("pending", "no"))).toBe(false);
    expect(decide("declined", "yes")).toBe("declined");
  });
  it("has no write or delete abilities", () => {
    expect(ASSISTANT_CAPABILITIES.some((c) => /write|delete|update|save/.test(c))).toBe(false);
  });
  it("reads edit blocks", () => {
    expect(parseEditProposal("Sure.<edit>Make header red</edit>")).toEqual({ text: "Sure.", edit: "Make header red" });
  });
});
