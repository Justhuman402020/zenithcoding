import { describe, it, expect } from "vitest";
import { shouldRetrySameModel } from "../src/lib/build-recovery";
describe("build retry", () => {
  it("retries a silent model up to 3 times", () => {
    expect(shouldRetrySameModel("x sent nothing for 90 seconds", true, 0)).toBe(true);
    expect(shouldRetrySameModel("x sent nothing", true, 3)).toBe(false);
  });
  it("retries network drops but not bad keys", () => {
    expect(shouldRetrySameModel("fetch failed", false, 1)).toBe(true);
    expect(shouldRetrySameModel("401 invalid api key", false, 0)).toBe(false);
  });
});
