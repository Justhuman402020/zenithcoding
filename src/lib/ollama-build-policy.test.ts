import { describe, it, expect } from "vitest";
import { orderOllamaBuildKeys, modelInstalled } from "./ollama-build-policy";

describe("Ollama build key choice", () => {
  it("uses the key turned on most recently, not the oldest saved one", () => {
    const rows = [
      { id: "mine", label: "mine", created_at: "2026-11-06T14:20:00Z", activated_at: "2026-11-06T14:21:00Z", active_model: "flux" },
      { id: "runpod", label: "againo", created_at: "2026-11-08T01:25:00Z", activated_at: "2026-11-08T01:26:00Z", active_model: "qwen3:8b" },
    ];
    expect(orderOllamaBuildKeys(rows).map((r) => r.id)).toEqual(["runpod", "mine"]);
  });
  it("skips keys with no model picked", () => {
    expect(orderOllamaBuildKeys([{ id: "a", label: null, created_at: "2026-01-01", activated_at: null, active_model: null }])).toEqual([]);
  });
  it("rejects a model that isn't installed on that Ollama", () => {
    expect(modelInstalled("hf.co/AtomicChat/FLUX-3-Image-Klein-TE-Uncensored-GGUF:Q6_K", ["qwen3:8b", "hf.co/Qwen/Qwen3-VL-8B-Instruct-GGUF:Q4_K_M"])).toBe(false);
  });
  it("treats a model without a tag as :latest", () => {
    expect(modelInstalled("qwen3", ["qwen3:latest"])).toBe(true);
  });
});
