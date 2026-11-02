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
  it("allows the saved Ollama tunnel rather than treating its hostname as Cloudflare AI", () => {
    const tunnel = "https://bars-add-scanner-part.trycloudflare.com";
    expect(isCloudflareUrl(tunnel)).toBe(false);
    expect(() => assertChatUrlAllowed(tunnel)).not.toThrow();
    expect(isCloudflareUrl(`${tunnel}/v1/models`)).toBe(false);
  });
  it("continues blocking actual Cloudflare inference and worker endpoints", () => {
    for (const endpoint of [
      "https://api.cloudflare.com/client/v4/accounts/x/ai/v1",
      "https://gateway.ai.cloudflare.com/v1/account/gateway",
      "https://pool.example.workers.dev/v1",
      "https://relay.example.org/ai/v1",
    ]) {
      expect(isCloudflareUrl(endpoint)).toBe(true);
      expect(() => assertChatUrlAllowed(endpoint)).toThrow();
    }
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
