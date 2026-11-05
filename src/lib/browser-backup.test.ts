import { describe, expect, it } from "vitest";
import { microlinkScreenshotUrl } from "./browser-check.server";

describe("backup screenshot browser", () => {
  it("uses the free endpoint without a key and the pro endpoint with one", () => {
    expect(microlinkScreenshotUrl("https://x.test", { width: 390, height: 844 }, true, false)).toMatch(/^https:\/\/api\.microlink\.io\//);
    expect(microlinkScreenshotUrl("https://x.test", { width: 390, height: 844 }, true, true)).toMatch(/^https:\/\/pro\.microlink\.io\//);
  });
  it("asks for an image at the requested phone size", () => {
    const q = new URL(microlinkScreenshotUrl("https://x.test/p?a=1", { width: 390, height: 844 }, true, false)).searchParams;
    expect(q.get("url")).toBe("https://x.test/p?a=1");
    expect(q.get("viewport.width")).toBe("390");
    expect(q.get("viewport.isMobile")).toBe("true");
    expect(q.get("embed")).toBe("screenshot.url");
  });
});
