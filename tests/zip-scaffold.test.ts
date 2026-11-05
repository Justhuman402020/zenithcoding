import { describe, it, expect } from "vitest";
import { scaffoldBuild } from "@/lib/zip-scaffold";
import { flattenedFramework } from "@/lib/completion-gate";

describe("zip scaffold", () => {
  it("adds index.html, vite config and build script only under the hidden folder", () => {
    const r = scaffoldBuild([{ path: "src/main.jsx", content: "" }]);
    expect(r.entry).toBe("src/main.jsx");
    expect(r.added.every((f) => f.path.startsWith(".code-haven-build/scaffold/"))).toBe(true);
    expect(r.added.find((f) => f.path.endsWith("index.html"))?.content).toContain('src="/src/main.jsx"');
  });
  it("does not add what the project already has", () => {
    const r = scaffoldBuild([{ path: "src/main.tsx", content: "" }, { path: "index.html", content: "" }, { path: "vite.config.ts", content: "" }, { path: "package.json", content: '{"scripts":{"build":"vite build"}}' }]);
    expect(r.added).toEqual([]);
  });
});

describe("flattening guard", () => {
  it("flags a framework project rewritten into one big inline index.html", () => {
    const big = `<script>${"x".repeat(7000)}</script>`;
    expect(flattenedFramework([{ path: "index.html", content: big }], ["package.json", "index.html"])).toBe("index.html");
  });
  it("allows a small index.html that loads the entry", () => {
    expect(flattenedFramework([{ path: "index.html", content: '<script type="module" src="/src/main.tsx"></script>' }], ["package.json"])).toBeNull();
  });
});
