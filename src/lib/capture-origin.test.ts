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
