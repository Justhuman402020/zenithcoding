import { describe, expect, it } from "vitest";
import { catalogModels, searchRouterModels, routerPriceLabel } from "../src/lib/openrouter-catalog";

describe("build key model catalog", () => {
  const models = catalogModels([
    { id: "nvidia/lightning", name: "NVIDIA: Lightning", created: 1792022400, architecture: { input_modalities: ["text"] }, context_length: 128000, pricing: { prompt: "0.000001" } },
    { id: "nvidia/super-vl", name: "NVIDIA: Super VL", description: "Reads pictures", architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools"] },
    { id: "other/vl-name", name: "VL in name only", architecture: { input_modalities: ["text"] } },
  ]);
  it("keeps all models in provider order with their exact IDs", () => {
    expect(searchRouterModels(models, "").map((m) => m.id)).toEqual(["nvidia/lightning", "nvidia/super-vl", "other/vl-name"]);
  });
  it("searches names and IDs without changing selection or order", () => {
    expect(searchRouterModels(models, "NVIDIA super").map((m) => m.id)).toEqual(["nvidia/super-vl"]);
  });
  it("requires declared image input rather than a VL name", () => {
    expect(searchRouterModels(models, "", true).map((m) => m.id)).toEqual(["nvidia/super-vl"]);
  });
  it("retains full provider metadata", () => {
    expect(models[0].contextLength).toBe(128000);
    expect(models[0].pricing.prompt).toBe("0.000001");
    expect(models[1].supportedParameters).toEqual(["tools"]);
    expect(models[0].releasedAt).toBe("2026-10-15T00:00:00.000Z");
  });
  it("marks only explicitly zero-priced models Free", () => {
    expect(routerPriceLabel({ prompt: "0", completion: "0", image: "0" })).toBe("Free");
    expect(routerPriceLabel({ prompt: "0", completion: "0.000001" })).toBe("Paid");
    expect(routerPriceLabel({ prompt: "0", completion: "0", image: "0.01" })).toBe("Paid");
    expect(routerPriceLabel({})).toBe("Pricing unavailable");
    expect(routerPriceLabel({ prompt: "-1", completion: "0" })).toBe("Pricing unavailable");
  });
});