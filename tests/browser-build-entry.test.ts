import { describe, expect, it, vi } from "vitest";

vi.mock("esbuild-wasm", async () => {
  const native = await import("esbuild");
  return { ...native, initialize: async () => {} };
});

import { buildInBrowser } from "@/lib/browser-build";

describe("preview entry file", () => {
  it("bundles a plain Vite project whose entry is src/main.tsx", async () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" } }) },
      { path: "index.html", content: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
      { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);' },
      { path: "src/App.tsx", content: "export default function App() { return <h1>SELENE</h1>; }" },
    ];
    const result = await buildInBrowser(files);
    expect(result.error ?? "").not.toMatch(/cannot be marked as external/);
    expect(result.ok).toBe(true);
  });
});

describe("preview stylesheets", () => {
  it("hands Tailwind v4 styles to the page and bundles plain CSS", async () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.1.0" } }) },
      { path: "index.html", content: '<!doctype html><html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>' },
      { path: "src/main.tsx", content: 'import "./index.css";\nimport "./plain.css";\nconsole.log(1);' },
      { path: "src/index.css", content: '@import "tailwindcss";\n@theme { --color-void: #05070c; }' },
      { path: "src/plain.css", content: ".hero { background: url(/layers/sky.webp); color: red; }" },
    ];
    const result = await buildInBrowser(files);
    expect(result.ok).toBe(true);
    const html = result.files!.find((f) => f.path === "index.html")!.content;
    expect(html).toContain('<style type="text/tailwindcss">');
    expect(html).toContain("--color-void: #05070c");
    expect(html).not.toContain('@import "tailwindcss"');
    const css = result.files!.find((f) => f.path.endsWith(".css"))!.content;
    expect(css).toContain("/layers/sky.webp");
  });
});

describe("preview setup script", () => {
  it("is valid JavaScript so preview placeholder keys load", async () => {
    const files = [
      { path: "package.json", content: "{}" },
      { path: "index.html", content: '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>' },
      { path: "src/main.ts", content: "console.log(import.meta.env.VITE_X);" },
    ];
    const result = await buildInBrowser(files);
    const html = result.files!.find((f) => f.path === "index.html")!.content;
    const inline = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    expect(() => new Function(inline)).not.toThrow();
  });
});
