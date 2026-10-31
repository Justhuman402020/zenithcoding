import { describe, it, expect } from "vitest";
import { shouldHandoff, projectNextTotal, mergeBaton, emptyBaton, batonNote } from "../src/lib/neuron-budget";

describe("neuron budget", () => {
  it("hands off at 8,500 when a step costs 700", () => expect(shouldHandoff(8500, [700])).toBe(true));
  it("keeps going at 7,000 with 700 steps", () => expect(shouldHandoff(7000, [700, 700])).toBe(false));
  it("always hands off at 9,000", () => expect(shouldHandoff(9000, [])).toBe(true));
  it("projects using the larger of last/avg cost", () => expect(projectNextTotal(1000, [100, 900])).toBe(1000 + 900 * 1.25));
  it("baton carries files and key log to the next key", () => {
    const a = mergeBaton(emptyBaton(), { files: ["a.tsx"], keyLog: [{ key: "Key #4", neurons: 8950, items: "1-7" }] });
    const b = mergeBaton(a, { files: ["b.tsx"] });
    expect(b.files).toEqual(["a.tsx", "b.tsx"]);
    expect(batonNote(b, "Key #5")).toContain("Key #4: 8950 Neurons");
  });
});
