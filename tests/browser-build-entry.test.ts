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
