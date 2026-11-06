import { describe, expect, it } from "vitest";
import { parseVisualReport } from "./visual-check-policy";
describe("visual verdict", () => {
  it("reads '**Overall: PASS**' as passed", () => expect(parseVisualReport("**Overall: PASS** (minor notes)").status).toBe("passed"));
  it("reads 'Verdict: PROBLEMS' as problems", () => expect(parseVisualReport("Verdict: PROBLEMS\n- x").status).toBe("problems"));
  it("still reads plain PASS", () => expect(parseVisualReport("PASS").status).toBe("passed"));
});
