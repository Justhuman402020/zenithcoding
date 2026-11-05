import { describe, it, expect } from "vitest";
import { isBuildable } from "@/lib/browser-build";

const f = (path: string, content = "") => ({ path, content });

describe("isBuildable for pasted ZIPs", () => {
  it("React ZIP with no build script or vite config still builds", () => {
    expect(isBuildable([f("package.json", '{"dependencies":{"react":"18"}}'), f("src/main.tsx")]).buildable).toBe(true);
  });
  it("source ZIP with no package.json but src/main.tsx builds", () => {
    expect(isBuildable([f("src/main.tsx"), f("src/App.tsx")]).buildable).toBe(true);
  });
  it("plain HTML site is served as-is, not built", () => {
    expect(isBuildable([f("index.html", "<h1>hi</h1>"), f("style.css")]).buildable).toBe(false);
  });
});
