import { describe, it, expect } from "vitest";
import { publicCaptureOrigin } from "./visual-check.server";
describe("publicCaptureOrigin", () => {
  it("swaps the internal build host for the public site", () => {
    expect(publicCaptureOrigin("https://project--4cd30b31-2a37-4c66-9cee-ab3d574ad805.lovable.app")).toBe("https://boostallsocial.org");
  });
  it("keeps a public origin", () => {
    expect(publicCaptureOrigin("https://boostallsocial.org")).toBe("https://boostallsocial.org");
  });
});
import { parseVisualReport } from "./visual-check-policy";
describe("parseVisualReport", () => {
  it("reads a bold PASS", () => { expect(parseVisualReport("**PASS** looks fine").status).toBe("passed"); });
});
import { imageMime, readerText } from "./visual-check.server";
describe("screenshot reading", () => {
  it("labels PNG screenshots as PNG", () => { expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png"); });
  it("uses the verdict from reasoning when the answer is empty", () => { expect(readerText({ content: "", reasoning: "thinking... PROBLEMS: button clipped" })).toBe("PROBLEMS: button clipped"); });
});
