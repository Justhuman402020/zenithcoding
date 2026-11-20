import { describe, it, expect } from "vitest";
import { publicCaptureOrigin } from "./visual-check.server";
describe("publicCaptureOrigin local hosts", () => {
  it("never sends the screenshot camera to localhost", () => {
    expect(publicCaptureOrigin("http://localhost")).toBe("https://boostallsocial.org");
    expect(publicCaptureOrigin("http://127.0.0.1:8787")).toBe("https://boostallsocial.org");
  });
});
