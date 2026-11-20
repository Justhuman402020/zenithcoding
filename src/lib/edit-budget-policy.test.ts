import { describe, it, expect } from "vitest";
import { lookOnlyAction } from "./edit-budget-policy";
describe("look-only step budget", () => {
  it("nudges after 6 steps without edits", () => { expect(lookOnlyAction(5, true)).toBe("none"); expect(lookOnlyAction(6, true)).toBe("nudge"); });
  it("stops after 10 steps without edits", () => { expect(lookOnlyAction(10, true)).toBe("stop"); });
  it("never limits plain chat", () => { expect(lookOnlyAction(20, false)).toBe("none"); });
});
