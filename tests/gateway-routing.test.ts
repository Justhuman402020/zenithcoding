import { describe, it, expect } from "vitest";
import { gatewayBaseURL } from "../src/lib/model-router.server";

const gw = { url: "https://gateway.ai.cloudflare.com/v1/acc/gw", enabled: true };
describe("AI gateway routing", () => {
  it("the OpenRouter Build key never goes through the Cloudflare gateway", () =>
    expect(gatewayBaseURL(gw, "build-openrouter", "https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1"));
  it("any OpenRouter provider goes direct", () =>
    expect(gatewayBaseURL(gw, "openrouter", "https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1"));
});
