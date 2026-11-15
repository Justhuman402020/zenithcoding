import { describe, expect, it } from "vitest";
import { orderChosenBySavedKey, requireChosen, sortModelsAZ, sortRowsAZ } from "./chosen-models";

describe("chosen models", () => {
  it("lists models of a key A to Z, ignoring case and duplicates", () => {
    expect(sortModelsAZ(["mistral-7b", "Gemini-3.5", "anthropic/claude", "Qwen3", "mistral-7b"])).toEqual(["anthropic/claude", "Gemini-3.5", "mistral-7b", "Qwen3"]);
    expect(sortModelsAZ(["b", "a", "a"])).toEqual(["a", "b"]);
  });
  it("never falls back when the chat has no chosen model", () => {
    expect(() => requireChosen(null)).toThrow(/pick one of your saved models/);
    expect(requireChosen({ provider: "ollama", keyRef: "k", model: "m" }).model).toBe("m");
  });
  it("orders board rows inside a key A to Z", () => {
    expect(sortRowsAZ([{ model: "models/gemini-2.5" }, { model: "models/aqa" }, { model: "models/Antigravity-preview" }]).map((r) => r.model)).toEqual(["models/Antigravity-preview", "models/aqa", "models/gemini-2.5"]);
  });
});
