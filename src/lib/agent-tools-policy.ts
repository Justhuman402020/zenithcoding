// Pure rules for the agent's sandbox/search/web tools so they stay unit-testable.
import type { BuildCheckIssue } from "./build-check";

export type ProjectFile = { path: string; content: string };

const TEXT_RE = /\.(tsx?|jsx?|mjs|cjs|json|css|scss|html|md|mdx|svg|txt|yml|yaml|toml|env\.example)$/i;
export const SANDBOX_MAX_BYTES = 4_000_000;

/** Text source files worth sending to the sandbox (no lockfiles, no media, no huge files). */
export function selectSandboxFiles(rows: ProjectFile[]): ProjectFile[] {
  const out: ProjectFile[] = [];
  let total = 0;
  for (const r of rows) {
    const p = r.path.replace(/^\/+/, "");
    if (!p || p.includes("..") || p.startsWith("node_modules/") || /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p)) continue;
    if (!TEXT_RE.test(p) && !/(^|\/)\.?[a-z]*rc$/i.test(p)) continue;
    const size = r.content?.length ?? 0;
    if (size > 400_000 || total + size > SANDBOX_MAX_BYTES) continue;
    total += size;
    out.push({ path: p, content: r.content ?? "" });
  }
  return out;
}

/** True when a real TypeScript check applies: a package.json plus TS source. */
export function canTypecheck(paths: string[]): boolean {
  return paths.includes("package.json") && paths.some((p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts") && !p.startsWith("node_modules/"));
}

/** Parses `tsc --pretty false` output into file:line issues. */
export function parseTscOutput(text: string): BuildCheckIssue[] {
  const issues: BuildCheckIssue[] = [];
  for (const line of text.split("\n")) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.+)$/.exec(line.trim());
    if (m) issues.push({ file: m[1]!.replace(/^\.\//, ""), line: Number(m[2]), message: `${m[3]} ${m[4]}` });
  }
  return issues;
}

/** Python run inside the E2B sandbox: write files, install, then run the step. */
export function sandboxScript(files: ProjectFile[], step: "typecheck" | "test" | "build", testFilter?: string): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(Object.fromEntries(files.map((f) => [f.path, f.content]))))));
  return `import base64, json, os, subprocess
root = "/home/user/app"
files = json.loads(base64.b64decode("${b64}").decode("utf-8"))
for p, c in files.items():
    full = os.path.join(root, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8").write(c)
def run(cmd, t):
    try:
        r = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=t)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timed out"
code, out = run("npm install --no-audit --no-fund --ignore-scripts --legacy-peer-deps --loglevel=error", 200)
result = {"install": code, "installTail": out[-1500:]}
pkg = json.load(open(os.path.join(root, "package.json")))
deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
step = ${JSON.stringify(step)}
if step == "typecheck":
    cfg = "tsconfig.app.json" if os.path.exists(os.path.join(root, "tsconfig.app.json")) else ("tsconfig.json" if os.path.exists(os.path.join(root, "tsconfig.json")) else "")
    if not cfg:
        json.dump({"compilerOptions": {"strict": False, "noEmit": True, "jsx": "react-jsx", "module": "esnext", "moduleResolution": "bundler", "target": "es2020", "skipLibCheck": True, "esModuleInterop": True, "allowJs": False, "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}, "include": ["src"]}, open(os.path.join(root, "tsconfig.codehaven.json"), "w"))
        cfg = "tsconfig.codehaven.json"
    tsc = "npx --no-install tsc" if "typescript" in deps else "npx -y -p typescript@5 tsc"
    code, out = run(tsc + " --noEmit --pretty false -p " + cfg, 150)
elif step == "test":
    if "vitest" not in deps:
        code, out = 0, "NO_TEST_RUNNER"
    else:
        code, out = run("npx --no-install vitest run --reporter=basic " + ${JSON.stringify(shellQuote(testFilter ?? ""))}, 180)
else:
    code, out = run("npm run build", 200)
result["code"] = code
result["out"] = out[-7000:]
print("@@RESULT@@" + json.dumps(result))
`;
}

export function shellQuote(s: string): string {
  if (!s) return "";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function readSandboxResult(stdout: string): { install: number; installTail: string; code: number; out: string } | null {
  const i = stdout.lastIndexOf("@@RESULT@@");
  if (i < 0) return null;
  try { return JSON.parse(stdout.slice(i + 10).trim().split("\n")[0]!); } catch { return null; }
}

/** Code search across project files with capped results. */
export function searchFiles(rows: ProjectFile[], pattern: string, opts: { regex?: boolean; path?: string; max?: number } = {}) {
  const max = Math.min(opts.max ?? 60, 200);
  let re: RegExp;
  try { re = opts.regex ? new RegExp(pattern, "i") : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  catch { return { ok: false as const, error: "Invalid regular expression" }; }
  const matches: Array<{ file: string; line: number; text: string }> = [];
  let truncated = false;
  for (const r of rows) {
    if (opts.path && !r.path.includes(opts.path)) continue;
    const lines = (r.content ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i]!)) continue;
      if (matches.length >= max) { truncated = true; break; }
      matches.push({ file: r.path, line: i + 1, text: lines[i]!.trim().slice(0, 200) });
    }
    if (truncated) break;
  }
  return { ok: true as const, matches, truncated };
}

/** Blocks non-https and private/internal addresses for agent web fetches. */
export function isBlockedUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  if (u.protocol !== "https:") return true;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h === "metadata.google.internal") return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":");
  return false;
}

/** Turns HTML into readable text for the model. */
export function htmlToText(html: string, max = 12_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max);
}

export const STALL_NOTE = "A tool just failed the same way twice. Do not call it again with the same input. Try a different approach (another tool, a different file, or a smaller change). If you truly cannot continue, stop and say \"Not finished\" with the exact blocker.";

/** Tracks identical failing tool calls; returns true when the same one failed twice in a row. */
export function createStallTracker() {
  let lastKey = "";
  let count = 0;
  return {
    record(key: string, failed: boolean): boolean {
      if (!failed) { if (key === lastKey) { lastKey = ""; count = 0; } return false; }
      if (key === lastKey) count += 1; else { lastKey = key; count = 1; }
      return count >= 2;
    },
  };
}
