// Worker-safe build check: finds the link errors that make Publish's bundler
// fail (missing files, missing named exports) without running a bundler.
// Pure so it can be unit-tested and called from the chat runner.

export type BuildCheckFile = { path: string; content: string };
export type BuildCheckIssue = { file: string; line: number; message: string };
export type BuildCheckResult = { ok: boolean; checked: number; issues: BuildCheckIssue[] };

const CODE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const CODE_RE = /\.(tsx?|jsx?|mjs|cjs)$/;

const norm = (p: string) => p.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+/g, "/");

function dirOf(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function join(base: string, rel: string) {
  const out: string[] = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function stripComments(src: string) {
  // Keep line count stable: replace comment text with spaces/newlines.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

function resolve(files: Map<string, string>, base: string): string | null {
  if (files.has(base) && CODE_RE.test(base)) return base;
  if (files.has(base)) return base;
  const noJs = base.replace(/\.(js|jsx|mjs)$/, "");
  for (const ext of CODE_EXT) if (files.has(noJs + ext)) return noJs + ext;
  for (const ext of CODE_EXT) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

function aliasTarget(spec: string, aliases: Array<[string, string]>): string | null {
  for (const [from, to] of aliases) if (spec.startsWith(from)) return norm(to + spec.slice(from.length));
  return null;
}

function readAliases(files: Map<string, string>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const name of ["tsconfig.app.json", "tsconfig.json", "jsconfig.json"]) {
    const raw = files.get(name);
    if (!raw) continue;
    try {
      const json = JSON.parse(stripComments(raw).replace(/,\s*([}\]])/g, "$1"));
      const paths = json?.compilerOptions?.paths ?? {};
      const baseUrl = norm(json?.compilerOptions?.baseUrl ?? ".").replace(/^\.$/, "");
      for (const [k, v] of Object.entries(paths)) {
        const t = Array.isArray(v) ? String(v[0] ?? "") : "";
        if (k.endsWith("/*") && t.endsWith("/*")) out.push([k.slice(0, -1), join(baseUrl, t.slice(0, -1)) + "/"]);
      }
    } catch { /* unreadable tsconfig: fall back to defaults */ }
  }
  if (!out.some(([k]) => k === "@/")) out.push(["@/", "src/"]);
  if (!out.some(([k]) => k === "~/")) out.push(["~/", "src/"]);
  return out;
}

type Exports = { names: Set<string>; wildcards: string[] };

function exportsOf(src: string): Exports {
  const code = stripComments(src);
  const names = new Set<string>();
  const wildcards: string[] = [];
  const decl = /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of code.matchAll(decl)) names.add(m[1]!);
  if (/export\s+default\b/.test(code)) names.add("default");
  for (const m of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] ?? as[0])!.trim());
    }
  }
  for (const m of code.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]!);
  for (const m of code.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) wildcards.push(m[1]!);
  // export const { a, b } = obj — destructured exports.
  for (const m of code.matchAll(/export\s+(?:const|let|var)\s+\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const p = part.split(":").pop()!.split("=")[0]!.trim();
      if (p) names.add(p);
    }
  }
  return { names, wildcards };
}

function lineAt(src: string, index: number) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

export function checkProjectBuild(input: BuildCheckFile[]): BuildCheckResult {
  const files = new Map<string, string>();
  for (const f of input) {
    const p = norm(f.path);
    if (p.startsWith("node_modules/") || p.startsWith("dist/")) continue;
    files.set(p, f.content);
  }
  const aliases = readAliases(files);
  const issues: BuildCheckIssue[] = [];
  const cache = new Map<string, Exports>();
  const exp = (p: string) => {
    let e = cache.get(p);
    if (!e) cache.set(p, (e = exportsOf(files.get(p) ?? "")));
    return e;
  };
  const target = (from: string, spec: string): { path: string | null; local: boolean } => {
    if (spec.startsWith(".")) return { path: resolve(files, join(dirOf(from), spec)), local: true };
    if (spec.startsWith("/")) return { path: resolve(files, norm(spec)), local: true };
    const a = aliasTarget(spec, aliases);
    if (a) return { path: resolve(files, a), local: true };
    return { path: null, local: false };
  };
  const hasExport = (path: string, name: string, seen = new Set<string>()): boolean | "unknown" => {
    if (seen.has(path)) return "unknown";
    seen.add(path);
    if (!CODE_RE.test(path)) return "unknown";
    const e = exp(path);
    if (e.names.has(name)) return true;
    let unknown = false;
    for (const w of e.wildcards) {
      const t = target(path, w);
      if (!t.local || !t.path) { unknown = true; continue; }
      const r = hasExport(t.path, name, seen);
      if (r === true) return true;
      if (r === "unknown") unknown = true;
    }
    // CommonJS modules have no static export list.
    if (/module\.exports|exports\.[A-Za-z_$]/.test(files.get(path) ?? "") && !e.names.size) return "unknown";
    return unknown ? "unknown" : false;
  };

  let checked = 0;
  const importRe = /(import|export)\s+(type\s+)?([\w$*\s{},]*?)\s*from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const [path, raw] of files) {
    if (!CODE_RE.test(path) || /\.d\.ts$/.test(path)) continue;
    checked++;
    const code = stripComments(raw);
    for (const m of code.matchAll(importRe)) {
      const spec = m[4] ?? m[5] ?? m[6]!;
      const t = target(path, spec);
      if (!t.local) continue;
      const line = lineAt(code, m.index ?? 0);
      if (!t.path) {
        // Asset imports may live in public/; only code modules must exist.
        if (/\.(css|scss|svg|png|jpe?g|gif|webp|avif|ico|json|woff2?|ttf|mp4|mp3)$/i.test(spec)) continue;
        issues.push({ file: path, line, message: `Could not resolve "${spec}"` });
        continue;
      }
      if (!m[4] || m[2]) continue; // side-effect, dynamic, or type-only import
      const clause = m[3]!.trim();
      const wanted: string[] = [];
      const brace = clause.match(/\{([^}]*)\}/);
      if (brace) {
        for (const part of brace[1]!.split(",")) {
          const p = part.trim();
          if (!p || p.startsWith("type ")) continue;
          wanted.push(p.split(/\s+as\s+/)[0]!.trim());
        }
      }
      const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
      if (m[1] === "import" && head && !head.startsWith("*")) wanted.push("default");
      for (const name of wanted) {
        if (hasExport(t.path, name) === false) {
          issues.push({ file: path, line, message: `No matching export in "${t.path}" for import "${name}"` });
        }
      }
    }
  }
  return { ok: issues.length === 0, checked, issues };
}

export function formatBuildIssues(r: BuildCheckResult, max = 15): string {
  if (r.ok) return `Build check passed (${r.checked} code files).`;
  const lines = r.issues.slice(0, max).map((i) => `- ${i.file}:${i.line}: ${i.message}`);
  if (r.issues.length > max) lines.push(`- …and ${r.issues.length - max} more`);
  return `Build check failed with ${r.issues.length} error(s):\n${lines.join("\n")}`;
}

/** True when the project is a bundled (React/Vite/TS) project the check applies to. */
export function isBundledProject(paths: string[]): boolean {
  return paths.some((p) => /\.(tsx|jsx|ts)$/.test(p) && !p.endsWith(".d.ts")) || paths.includes("package.json");
}
