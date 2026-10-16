// In-browser build pipeline using esbuild-wasm.
// Bundles a Vite/React/Vue/Svelte source project into static dist/ files
// entirely client-side. Bare imports are resolved via https://esm.sh.
// Not designed for SSR frameworks (Next.js, Remix, TanStack Start source).

import type * as esbuild from "esbuild-wasm";

export type BuildFile = { path: string; content: string };
export type BuildLog = {
  level: "info" | "warn" | "error" | "success";
  message: string;
  ts: number;
};

export type BuildResult =
  | { ok: true; files: BuildFile[]; logs: BuildLog[]; warnings: string[] }
  | { ok: false; error: string; logs: BuildLog[] };

type Emit = (log: BuildLog) => void;

const ESBUILD_VERSION = "0.28.1";
const ESM_SH = "https://esm.sh";

let _esbuildReady: Promise<typeof esbuild> | null = null;

async function loadEsbuild(): Promise<typeof esbuild> {
  if (!_esbuildReady) {
    _esbuildReady = (async () => {
      const mod = (await import("esbuild-wasm")) as typeof esbuild;
      await mod.initialize({
        wasmURL: `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`,
        worker: true,
      });
      return mod;
    })();
  }
  return _esbuildReady;
}

function normalizePath(p: string): string {
  return p.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return normalizePath(rel);
  const baseParts = base.split("/").slice(0, -1);
  const relParts = rel.split("/");
  for (const part of relParts) {
    if (part === "" || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function loaderFor(path: string): esbuild.Loader {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".ts": return "ts";
    case ".tsx": return "tsx";
    case ".jsx": return "jsx";
    case ".js":
    case ".mjs":
    case ".cjs": return "js";
    case ".css": return "css";
    case ".json": return "json";
    case ".svg":
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".ico": return "dataurl";
    default: return "text";
  }
}

const RESOLVE_EXTS = ["", ".ts", ".tsx", ".jsx", ".js", ".mjs", ".css", ".json"];
const INDEX_EXTS = [".ts", ".tsx", ".jsx", ".js"];

function tryResolve(fsMap: Map<string, string>, rawPath: string): string | null {
  const p = normalizePath(rawPath);
  for (const ext of RESOLVE_EXTS) {
    if (fsMap.has(p + ext)) return p + ext;
  }
  for (const ext of INDEX_EXTS) {
    if (fsMap.has(`${p}/index${ext}`)) return `${p}/index${ext}`;
  }
  return null;
}

function parsePackageJson(raw: string | undefined): {
  deps: Record<string, string>;
  hasTailwind: boolean;
  hasReact: boolean;
  hasVue: boolean;
  hasSvelte: boolean;
} {
  const empty = { deps: {}, hasTailwind: false, hasReact: false, hasVue: false, hasSvelte: false };
  if (!raw) return empty;
  try {
    const pkg = JSON.parse(raw);
    const deps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    return {
      deps,
      hasTailwind: Boolean(deps["tailwindcss"] || deps["@tailwindcss/vite"]),
      hasReact: Boolean(deps["react"]),
      hasVue: Boolean(deps["vue"]),
      hasSvelte: Boolean(deps["svelte"]),
    };
  } catch {
    return empty;
  }
}

function cleanVersion(v: string | undefined): string {
  if (!v) return "latest";
  const s = v.trim();
  if (s.startsWith("workspace:") || s.startsWith("link:") || s.startsWith("file:")) return "latest";
  if (/^(https?:|git|github:)/i.test(s)) return "latest";
  return s.replace(/^[\^~<>=v]+/, "") || "latest";
}

function esmShUrl(spec: string, deps: Record<string, string>): string {
  // spec may be "react" or "react/jsx-runtime" or "@scope/pkg/sub"
  let name = spec;
  let sub = "";
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    name = parts.slice(0, 2).join("/");
    sub = parts.slice(2).join("/");
  } else {
    const i = spec.indexOf("/");
    if (i >= 0) {
      name = spec.slice(0, i);
      sub = spec.slice(i + 1);
    }
  }
  const ver = cleanVersion(deps[name]);
  const path = sub ? `/${sub}` : "";
  return `${ESM_SH}/${name}@${ver}${path}`;
}

function detectSSRFramework(deps: Record<string, string>): string | null {
  if (deps["next"]) return "Next.js";
  if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "Remix";
  if (deps["@tanstack/react-start"] || deps["@tanstack/start"]) return "TanStack Start";
  if (deps["@sveltejs/kit"]) return "SvelteKit";
  if (deps["nuxt"] || deps["nuxt3"]) return "Nuxt";
  if (deps["astro"]) return "Astro";
  return null;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 8);
}

function extractEntryFromHtml(html: string): { entry: string | null; rewritten: string } {
  // find first <script type="module" src="...">
  const m = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/i);
  if (!m) return { entry: null, rewritten: html };
  return { entry: m[1], rewritten: html };
}

function stripScript(html: string, src: string): string {
  const re = new RegExp(
    `<script\\b[^>]*src=["']${src.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}["'][^>]*>\\s*<\\/script>`,
    "i",
  );
  return html.replace(re, "");
}

export type BuildOptions = { env?: Record<string, string> };

// Reads tsconfig/jsconfig "paths" (e.g. "@/*": ["./src/*"]); defaults to @/ and ~/ -> src/.
function readAliases(fsMap: Map<string, string>): [string, string][] {
  const out: [string, string][] = [];
  for (const name of ["tsconfig.app.json", "tsconfig.json", "jsconfig.json"]) {
    const raw = fsMap.get(name);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,\s*([}\]])/g, "$1"));
      const base = normalizePath(j.compilerOptions?.baseUrl || ".").replace(/^\.$/, "");
      const paths = j.compilerOptions?.paths || {};
      for (const [k, v] of Object.entries(paths)) {
        const target = Array.isArray(v) ? String(v[0] || "") : "";
        if (!k.endsWith("/*") || !target.endsWith("/*")) continue;
        out.push([k.slice(0, -1), normalizePath([base, target.slice(0, -1)].filter(Boolean).join("/"))]);
      }
    } catch {}
  }
  if (!out.some(([k]) => k === "@/")) out.push(["@/", "src/"]);
  if (!out.some(([k]) => k === "~/")) out.push(["~/", "src/"]);
  return out;
}

const ENTRY_CANDIDATES = ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.ts", "src/index.js", "main.tsx", "main.jsx", "index.tsx", "index.jsx"];

// Preview-only env runtime: real values when saved, safe placeholders otherwise,
// so createClient()/fetch setup never crashes into a blank page.
function envRuntimeScript(env: Record<string, string>): string {
  return `<script>(function(){var real=${JSON.stringify(env).replace(/</g, "\\u003c")};var missing={};
function mock(k){missing[k]=1;if(/SUPABASE_URL/.test(k))return "https://placeholder-project.supabase.co";if(/URL|ENDPOINT|HOST/.test(k))return "https://placeholder.invalid";if(/SUPABASE.*(KEY|ANON|PUBLISHABLE)/.test(k))return "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder";if(/^(VITE_)?STRIPE/.test(k))return "pk_test_placeholder";return "placeholder_"+k.toLowerCase();}
var base=Object.assign({MODE:"production",PROD:true,DEV:false,SSR:false,BASE_URL:"/",NODE_ENV:"production"},real);
globalThis.__CH_ENV__=new Proxy(base,{get:function(t,k){if(k in t)return t[k];if(typeof k!=="string"||!/^[A-Z][A-Z0-9_]*$/.test(k))return undefined;return mock(k);},has:function(){return true;}});
globalThis.process=globalThis.process||{env:globalThis.__CH_ENV__};
window.addEventListener("load",function(){setTimeout(function(){var ks=Object.keys(missing);if(!ks.length)return;var b=document.createElement("div");b.setAttribute("data-ch-env-banner","");b.style.cssText="position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#2a1748;color:#f3e8ff;border:1px solid #8b5cf6;border-radius:10px;padding:8px 12px;font:13px system-ui;display:flex;gap:8px;align-items:center";b.innerHTML="<span>&#128273; Preview is using placeholders for: <b></b>. Add real keys in the Setup table above the preview.</span><button style=\"margin-left:auto;background:none;border:0;color:inherit;cursor:pointer;font-size:16px\">&times;</button>";b.querySelector("b").textContent=ks.join(", ");b.querySelector("button").onclick=function(){b.remove()};document.body.appendChild(b);parent.postMessage({type:"ch-env-missing",keys:ks},"*");},400);});})();<\/script>`;
}

export async function buildInBrowser(
  files: BuildFile[],
  onLog?: Emit,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  const logs: BuildLog[] = [];
  const log = (level: BuildLog["level"], message: string) => {
    const entry = { level, message, ts: Date.now() };
    logs.push(entry);
    onLog?.(entry);
  };

  try {
    const fsMap = new Map<string, string>();
    for (const f of files) fsMap.set(normalizePath(f.path), f.content);

    const pkgRaw = fsMap.get("package.json");
    const { deps, hasTailwind, hasReact, hasVue, hasSvelte } = parsePackageJson(pkgRaw);

    const ssr = detectSSRFramework(deps);
    if (ssr) {
      const msg = `${ssr} is a server-rendered framework and can't be built in the browser. Publish source instead.`;
      log("error", msg);
      return { ok: false, error: msg, logs };
    }

    let indexHtml = fsMap.get("index.html") || fsMap.get("public/index.html") || "";
    let { entry } = extractEntryFromHtml(indexHtml);
    if (!entry) {
      const found = ENTRY_CANDIDATES.find((c) => fsMap.has(c));
      if (!found) {
        const msg = "No entry file found (looked for index.html script, src/main.tsx, src/index.tsx…).";
        log("error", msg);
        return { ok: false, error: msg, logs };
      }
      entry = "/" + found;
      log("warn", `No module entry in index.html — using ${found}`);
      if (!indexHtml) indexHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title></head><body><div id="root"></div><div id="app"></div></body></html>`;
      indexHtml = indexHtml.replace(/<\/body>/i, `<script type="module" src="${entry}"></script></body>`);
    }
    const aliases = readAliases(fsMap);

    const entryPath = normalizePath(entry.replace(/^\/+/, ""));
    const resolvedEntry = tryResolve(fsMap, entryPath) || entryPath;
    if (!fsMap.has(resolvedEntry)) {
      const msg = `Entry file not found: ${entryPath}`;
      log("error", msg);
      return { ok: false, error: msg, logs };
    }

    log("info", `Loading esbuild-wasm@${ESBUILD_VERSION}…`);
    const esb = await loadEsbuild();
    log("success", "Bundler ready");

    log("info", `Detected: ${hasReact ? "React " : ""}${hasVue ? "Vue " : ""}${hasSvelte ? "Svelte " : ""}${hasTailwind ? "+ Tailwind" : ""}`.trim() || "vanilla");
    log("info", `Bundling entry: ${resolvedEntry}`);

    const virtualPlugin: esbuild.Plugin = {
      name: "forge-virtual-fs",
      setup(build) {
        // esm.sh URLs -> external (browser fetches them)
        build.onResolve({ filter: /^https?:\/\// }, (args) => ({
          path: args.path,
          external: true,
        }));

        // Path aliases (@/, ~/, tsconfig paths) -> virtual FS
        build.onResolve({ filter: /^[@~#]/ }, (args) => {
          const hit = aliases.find(([k]) => args.path.startsWith(k));
          if (!hit) return undefined;
          const target = hit[1] + args.path.slice(hit[0].length);
          const resolved = tryResolve(fsMap, target);
          if (!resolved) return { errors: [{ text: `Cannot resolve alias "${args.path}" (looked in ${target})` }] };
          return { path: resolved, namespace: "vfs" };
        });

        // Bare imports -> rewrite to esm.sh
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          // node built-ins -> mark external so esbuild doesn't try to bundle
          const nodeBuiltins = /^(fs|path|crypto|stream|util|events|url|http|https|os|child_process|node:.*)$/;
          if (nodeBuiltins.test(args.path)) {
            return { path: args.path, external: true };
          }
          return { path: esmShUrl(args.path, deps), external: true };
        });

        // Relative / absolute -> resolve inside virtual FS
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point") {
            return { path: args.path, namespace: "vfs" };
          }
          const importerPath = args.importer;
          const abs = importerPath.startsWith("vfs:")
            ? joinPath(importerPath.slice(4), args.path)
            : joinPath(importerPath, args.path);
          const resolved = tryResolve(fsMap, abs);
          if (!resolved) {
            return { errors: [{ text: `Cannot resolve "${args.path}" from ${importerPath}` }] };
          }
          return { path: resolved, namespace: "vfs" };
        });

        build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
          const contents = fsMap.get(args.path);
          if (contents == null) return { errors: [{ text: `Missing file: ${args.path}` }] };
          return { contents, loader: loaderFor(args.path), resolveDir: "/" };
        });
      },
    };

    const jsxOptions: Partial<esbuild.BuildOptions> = hasReact
      ? { jsx: "automatic", jsxImportSource: "react" }
      : {};

    const result = await esb.build({
      entryPoints: [resolvedEntry],
      bundle: true,
      write: false,
      format: "esm",
      target: ["es2020"],
      platform: "browser",
      minify: true,
      sourcemap: false,
      splitting: false,
      plugins: [virtualPlugin],
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env.MODE": '"production"',
        "import.meta.env.PROD": "true",
        "import.meta.env.DEV": "false",
        "import.meta.env": "globalThis.__CH_ENV__",
        "process.env": "globalThis.__CH_ENV__",
      },
      logLevel: "silent",
      ...jsxOptions,
    });

    const warnings = result.warnings.map((w) => w.text);
    for (const w of warnings) log("warn", w);

    const outFiles = result.outputFiles || [];
    let js = "";
    let css = "";
    for (const f of outFiles) {
      if (f.path.endsWith(".css")) css += f.text;
      else js += f.text;
    }

    const jsHash = hashString(js).slice(0, 8);
    const cssHash = css ? hashString(css).slice(0, 8) : "";
    const jsName = `assets/index-${jsHash}.js`;
    const cssName = css ? `assets/index-${cssHash}.css` : "";

    // Rewrite index.html: strip original entry script, inject built assets.
    let html = stripScript(indexHtml, entry);
    const tailwindCdn = hasTailwind
      ? `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`
      : "";
    const headInjects: string[] = [envRuntimeScript(opts.env || {})];
    if (tailwindCdn) headInjects.push(tailwindCdn);
    if (cssName) headInjects.push(`<link rel="stylesheet" href="/${cssName}">`);
    const bodyInjects: string[] = [
      `<script type="module" src="/${jsName}"></script>`,
    ];
    if (/<\/head>/i.test(html) && headInjects.length) {
      html = html.replace(/<\/head>/i, `${headInjects.join("\n")}\n</head>`);
    } else if (headInjects.length) {
      html = `${headInjects.join("\n")}\n${html}`;
    }
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${bodyInjects.join("\n")}\n</body>`);
    } else {
      html = `${html}\n${bodyInjects.join("\n")}`;
    }

    const built: BuildFile[] = [{ path: "index.html", content: html }];
    built.push({ path: jsName, content: js });
    if (cssName) built.push({ path: cssName, content: css });

    // Copy public/* and any non-source assets that /s/$slug might reference.
    for (const f of files) {
      const p = normalizePath(f.path);
      if (p.startsWith("public/")) {
        built.push({ path: p.slice("public/".length), content: f.content });
      }
    }

    log("success", `Built ${built.length} file(s) · JS ${(js.length / 1024).toFixed(1)}KB${css ? ` · CSS ${(css.length / 1024).toFixed(1)}KB` : ""}`);
    return { ok: true, files: built, logs, warnings };
  } catch (e: any) {
    const msg = e?.message || String(e) || "Build failed";
    log("error", msg);
    return { ok: false, error: msg, logs };
  }
}

export function isBuildable(files: BuildFile[]): { buildable: boolean; reason?: string } {
  const pkg = files.find((f) => normalizePath(f.path) === "package.json");
  const html = files.find((f) => normalizePath(f.path) === "index.html");
  if (!pkg) return { buildable: false, reason: "no package.json" };
  if (!html) return { buildable: false, reason: "no index.html" };
  try {
    const p = JSON.parse(pkg.content);
    const hasScript = p.scripts && (p.scripts.build || p.scripts.dev);
    if (!hasScript) return { buildable: false, reason: "no build script" };
    return { buildable: true };
  } catch {
    return { buildable: false, reason: "invalid package.json" };
  }
}
