import { expect, it } from "vitest";
import { parseVisualReport, visualCheckRequested, visualRoundAllowed, visualVerificationNeeded } from "../src/lib/visual-check-policy";
it("only runs vision for an explicit preview or screenshot check", () => { expect(visualCheckRequested("Take a screenshot and fix my preview")).toBe(true); expect(visualCheckRequested("Write a pricing page")).toBe(false); });
it("requires real screenshots for the generated preview repair request", () => {
  expect(visualCheckRequested("Fix this error in the preview. Use the exact message, line number, code excerpt and stack below instead of guessing.")).toBe(true);
});
it("recognizes a blank or broken preview without an explicit screenshot command", () => {
  expect(visualCheckRequested("My preview is blank fix it")).toBe(true);
  expect(visualCheckRequested("Repair my preview")).toBe(true);
  expect(visualCheckRequested("The preview is not loading")).toBe(true);
});
it("does not turn unrelated repairs or ordinary preview mentions into paid checks", () => {
  expect(visualCheckRequested("Fix my billing form")).toBe(false);
  expect(visualCheckRequested("Add a preview button")).toBe(false);
});
it("does not call a vague response a pass", () => { expect(parseVisualReport("Looks nice").status).toBe("unverified"); expect(parseVisualReport("PROBLEMS: Phone text overlaps").status).toBe("problems"); expect(parseVisualReport("PASS: No visible overlap").status).toBe("passed"); });
it("stops after three saved repair/check rounds", () => { expect(visualRoundAllowed(2)).toBe(true); expect(visualRoundAllowed(3)).toBe(false); });
it("automatically inspects visible edits without another request",()=>{for(const prompt of ["Write a pricing page","Fix my billing form","Change the theme","Import this ZIP","Fix the mobile menu"])expect(visualVerificationNeeded(prompt,true)).toBe(true);});
it("allows read-only preview diagnosis",()=>expect(visualVerificationNeeded("Inspect my preview",false)).toBe(true));
it("skips conversation and invisible configuration",()=>{expect(visualVerificationNeeded("Hello",false)).toBe(false);expect(visualVerificationNeeded("Change the API token",true)).toBe(false);expect(visualVerificationNeeded("Which model is selected?",false)).toBe(false);});