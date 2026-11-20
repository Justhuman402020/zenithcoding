import { describe, expect, it } from "vitest";
import { classifySection, providerBrand, formatMs } from "../src/lib/model-calls";

describe("recent models", () => {
  it("labels plan, image build, build and chat", () => {
    expect(classifySection({ plan: true, fileChange: true })).toBe("plan");
    expect(classifySection({ imageBuild: true, fileChange: true })).toBe("image_build");
    expect(classifySection({ fileChange: true })).toBe("build");
    expect(classifySection({})).toBe("chat");
    expect(classifySection({ skill: true, fileChange: true })).toBe("skill");
  });
  it("shows the OpenRouter icon for OpenRouter models and others for theirs", () => {
    expect(providerBrand("build-openrouter")).toBe("openrouter");
    expect(providerBrand("custom-1", "https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(providerBrand("cf-pool-3", "https://api.cloudflare.com/x")).toBe("cloudflare");
    expect(providerBrand("ollama")).toBe("ollama");
    expect(providerBrand("mystery", "https://example.com")).toBe("other");
  });
  it("formats reply times", () => {
    expect(formatMs(850)).toBe("850ms");
    expect(formatMs(1234)).toBe("1.2s");
    expect(formatMs(null)).toBe("—");
  });
});
