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

describe("ZIP import saves the build setup", () => {
  it("unpackZip stores the setup under .code-haven-build/scaffold/ and keeps user files unchanged", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const { unpackZip } = await import("@/lib/zip-import");
    const bytes = zipSync({ "site/src/main.tsx": strToU8("console.log(1)"), "site/src/App.tsx": strToU8("x") });
    const file = new File([bytes], "site.zip", { type: "application/zip" });
    const { files } = await unpackZip(file);
    expect(files.find((f) => f.path === "src/main.tsx")?.content).toBe("console.log(1)");
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".code-haven-build/scaffold/index.html");
    expect(paths).toContain(".code-haven-build/scaffold/vite.config.ts");
    expect(paths).toContain(".code-haven-build/scaffold/package.json");
    expect(paths).not.toContain("index.html");
  });
});
