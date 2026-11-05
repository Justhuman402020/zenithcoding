// Default build setup for pasted projects that lack one. Pure: returns extra
// files under .code-haven-build/scaffold/ and never touches the user's files.
export const SCAFFOLD_DIR = ".code-haven-build/scaffold/";

export const ENTRY_FILES = ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js", "main.tsx", "main.jsx", "index.tsx", "index.jsx"];

export type ScaffoldFile = { path: string; content: string };

export function findEntry(paths: string[]): string | null {
  const set = new Set(paths);
  return ENTRY_FILES.find((e) => set.has(e)) ?? null;
}

const DEFAULT_HTML = (entry: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title></head><body><div id="root"></div><div id="app"></div><script type="module" src="/${entry}"></script></body></html>`;

export function scaffoldBuild(files: ScaffoldFile[]): { entry: string | null; added: ScaffoldFile[] } {
  const paths = files.map((f) => f.path.replace(/^\/+/, ""));
  const has = (p: string) => paths.includes(p);
  const entry = findEntry(paths);
  if (!entry) return { entry: null, added: [] };
  const added: ScaffoldFile[] = [];
  if (!has("index.html")) added.push({ path: `${SCAFFOLD_DIR}index.html`, content: DEFAULT_HTML(entry) });
  if (!paths.some((p) => /^vite\.config\.[cm]?[jt]s$/.test(p))) {
    added.push({ path: `${SCAFFOLD_DIR}vite.config.ts`, content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });\n` });
  }
  let pkg: any = null;
  try { pkg = JSON.parse(files.find((f) => f.path === "package.json")?.content ?? "null"); } catch { pkg = null; }
  if (!pkg?.scripts?.build) {
    added.push({ path: `${SCAFFOLD_DIR}package.json`, content: JSON.stringify({ ...(pkg ?? { name: "pasted-site", private: true, type: "module" }), scripts: { ...(pkg?.scripts ?? {}), dev: "vite", build: "vite build" } }, null, 2) });
  }
  return { entry, added };
}

export { DEFAULT_HTML as defaultIndexHtml };
