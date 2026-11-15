import { describe, expect, it } from "vitest";
import { orderChosenBySavedKey, requireChosen, sortKeysBySavedAt, sortModelsAZ, sortRowsAZ } from "./chosen-models";

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
  it("keeps saved keys in saved order with the newest key at the bottom, names unchanged", () => {
    const keys = [
      { label: "Zeta key", savedAt: "2026-09-01T00:00:00Z" },
      { label: "OpenRouter (Build key)", savedAt: "2026-10-25T12:32:11Z" },
      { label: "Google ai studio  #1", savedAt: "2026-11-15T04:14:57Z" },
      { label: "Alpha key", savedAt: "2026-08-30T06:47:37Z" },
    ];
    expect(sortKeysBySavedAt(keys).map((k) => k.label)).toEqual(["Alpha key", "Zeta key", "OpenRouter (Build key)", "Google ai studio  #1"]);
  });
  it("chat picker follows key saved order, only models inside a key go A to Z", () => {
    const rows = [
      { provider: "registry", key_ref: "newest", model: "a-model" },
      { provider: "registry", key_ref: "oldest", model: "zeta" },
      { provider: "registry", key_ref: "oldest", model: "Beta" },
    ];
    expect(orderChosenBySavedKey(rows, ["oldest", "newest"]).map((r) => `${r.key_ref}:${r.model}`)).toEqual(["oldest:Beta", "oldest:zeta", "newest:a-model"]);
  });
});
