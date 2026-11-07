// Extra agent tools: real typecheck/tests in the E2B sandbox, code search,
// web page reading, live URL probing and real browser console logs.
import { tool } from "ai";
import { z } from "zod";
import type { TraceLogger } from "./trace.server";
import type { BuildCheckResult } from "./build-check";
import {
  canTypecheck, htmlToText, isBlockedUrl, parseTscOutput, readSandboxResult, sandboxScript,
  searchFiles, selectSandboxFiles, type ProjectFile,
} from "./agent-tools-policy";

async function sandbox(rows: ProjectFile[], step: "typecheck" | "test" | "build", filter?: string) {
  const { e2bRunCode } = await import("./integration-keys.server");
  const r = await e2bRunCode(sandboxScript(selectSandboxFiles(rows), step, filter), "python", { timeoutSec: 420, maxOut: 12_000 });
  if (!r.ok) return { ok: false as const, error: r.error };
  const res = readSandboxResult(r.stdout);
  if (!res) return { ok: false as const, error: `Sandbox gave no result. ${r.stderr.slice(0, 300)}` };
  return { ok: true as const, ...res };
}

export type TypecheckOutcome = { ran: boolean; note: string; result?: BuildCheckResult };

/** Real `tsc --noEmit` on the project's own files after installing its packages. */
export async function runTypecheck(rows: ProjectFile[]): Promise<TypecheckOutcome> {
  if (!canTypecheck(rows.map((r) => r.path))) return { ran: false, note: "Type check skipped: no package.json with TypeScript files." };
  try {
    const r = await sandbox(rows, "typecheck");
    if (!r.ok) return { ran: false, note: `Type check unavailable: ${r.error}` };
    if (r.install !== 0) return { ran: false, note: `Type check unavailable: package install failed.\n${r.installTail.slice(-600)}` };
    const issues = parseTscOutput(r.out);
    if (r.code !== 0 && !issues.length) return { ran: false, note: `Type check could not finish:\n${r.out.slice(-600)}` };
    return { ran: true, note: issues.length ? "" : "Type check passed.", result: { ok: !issues.length, checked: rows.length, issues } };
  } catch (e) {
    return { ran: false, note: `Type check unavailable: ${e instanceof Error ? e.message : "sandbox error"}` };
  }
}

async function projectRows(projectId: string): Promise<ProjectFile[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("files").select("path,content").eq("project_id", projectId);
  return (data ?? []) as ProjectFile[];
}

async function safeFetch(url: string, init: RequestInit = {}, timeoutMs = 20_000) {
  if (isBlockedUrl(url)) throw new Error("Only public https addresses are allowed.");
  return fetch(url, { redirect: "follow", ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "CodeHaven/1.0 agent", ...(init.headers ?? {}) } });
}

/** Calls ping every 20s while a long task runs. */
export async function withKeepAlive<T>(ping: () => void, run: () => Promise<T>): Promise<T> {
  const t = setInterval(ping, 20_000);
  try { return await run(); } finally { clearInterval(t); }
}

export function createAgentTools(opts: { projectId: string; origin: string; trace?: TraceLogger; readOnly?: boolean; keepAlive?: () => void }) {
  const long = <T,>(run: () => Promise<T>) => withKeepAlive(opts.keepAlive ?? (() => {}), run);
  const log = (phase: string, detail: Record<string, unknown>) => opts.trace?.log(phase, { detail });
  const publishedUrl = async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("projects").select("slug,published").eq("id", opts.projectId).maybeSingle();
    return (data as any)?.published && (data as any)?.slug ? `${opts.origin}/s/${(data as any).slug}` : null;
  };
  const tools = {
    search_code: tool({
      description: "Search every project file for a word, name or regex. Returns file:line matches. Use this instead of opening files one by one.",
      inputSchema: z.object({ pattern: z.string().min(1).max(200), regex: z.boolean().optional(), path: z.string().max(200).optional() }),
      execute: async ({ pattern, regex, path }) => {
        const r = searchFiles(await projectRows(opts.projectId), pattern, { regex, path });
        log("tool.search_code", { pattern, matches: r.ok ? r.matches.length : 0 });
        return r;
      },
    }),
    fetch_url: tool({
      description: "Open a public https web page (docs, API reference) and read its text.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try {
          const res = await safeFetch(url);
          const type = res.headers.get("content-type") ?? "";
          const body = (await res.text()).slice(0, 600_000);
          log("tool.fetch_url", { url, status: res.status });
          return { ok: res.ok, status: res.status, text: type.includes("html") ? htmlToText(body) : body.slice(0, 12_000) };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "fetch failed" }; }
      },
    }),
    probe_url: tool({
      description: "Check whether the published site (leave url empty) or any public https address answers: status code, page title, time.",
      inputSchema: z.object({ url: z.string().url().optional() }),
      execute: async ({ url }) => {
        const target = url ?? (await publishedUrl());
        if (!target) return { ok: false, error: "This project isn't published yet." };
        const started = Date.now();
        try {
          const res = await safeFetch(target, {}, 15_000);
          const html = (await res.text()).slice(0, 200_000);
          const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
          log("tool.probe_url", { url: target, status: res.status });
          return { ok: res.ok, status: res.status, title, ms: Date.now() - started, finalUrl: res.url };
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "no answer", ms: Date.now() - started }; }
      },
    }),
    read_site_logs: tool({
      description: "Open the published site (or a public https url) in a real headless browser and return its console errors, page crashes and failed network requests. Takes about a minute.",
      inputSchema: z.object({ url: z.string().url().optional() }),
      execute: async ({ url }) => {
        const target = url ?? (await publishedUrl());
        if (!target) return { ok: false, error: "This project isn't published yet." };
        if (isBlockedUrl(target)) return { ok: false, error: "Only public https addresses are allowed." };
        const { e2bRunCode } = await import("./integration-keys.server");
        const code = `import subprocess, json
subprocess.run("pip install -q playwright && python -m playwright install --with-deps chromium", shell=True, capture_output=True, timeout=240)
from playwright.sync_api import sync_playwright
logs = {"console": [], "pageErrors": [], "failedRequests": []}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    pg.on("console", lambda m: logs["console"].append(f"{m.type}: {m.text}"[:300]) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: logs["pageErrors"].append(str(e)[:400]))
    pg.on("requestfailed", lambda r: logs["failedRequests"].append(f"{r.method} {r.url[:200]} {r.failure}"))
    pg.on("response", lambda r: logs["failedRequests"].append(f"{r.status} {r.url[:200]}") if r.status >= 400 else None)
    try:
        pg.goto(${JSON.stringify(target)}, wait_until="networkidle", timeout=45000)
    except Exception as e:
        logs["pageErrors"].append("navigation: " + str(e)[:300])
    pg.wait_for_timeout(2500)
    logs["title"] = pg.title()
    b.close()
for k in ("console", "pageErrors", "failedRequests"):
    logs[k] = logs[k][:40]
print("@@RESULT@@" + json.dumps(logs))`;
        const r = await long(() => e2bRunCode(code, "python", { timeoutSec: 360, maxOut: 12_000 }));
        if (!r.ok) return { ok: false, error: r.error };
        const i = r.stdout.lastIndexOf("@@RESULT@@");
        log("tool.read_site_logs", { url: target, ok: i >= 0 });
        if (i < 0) return { ok: false, error: `Browser could not start. ${r.stderr.slice(0, 300)}` };
        try { return { ok: true, url: target, ...JSON.parse(r.stdout.slice(i + 10).trim().split("\n")[0]!) }; }
        catch { return { ok: false, error: "Could not read browser logs." }; }
      },
    }),
    typecheck: tool({
      description: "Run the real TypeScript compiler (tsc --noEmit) on the project after installing its packages. Returns file:line type errors. Takes 1-3 minutes; run once after your edits, fix everything, then run again.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await projectRows(opts.projectId);
        const t = await long(() => runTypecheck(rows));
        log("tool.typecheck", { ran: t.ran, issues: t.result?.issues.length ?? 0 });
        if (!t.result) return { ok: false, report: t.note };
        const { formatBuildIssues } = await import("./build-check");
        return { ok: t.result.ok, report: t.result.ok ? t.note : formatBuildIssues(t.result).replace("Build check", "Type check") };
      },
    }),
    run_tests: tool({
      description: "Run the project's own vitest test files in a sandbox. Optional filter narrows to matching test files.",
      inputSchema: z.object({ filter: z.string().max(200).optional() }),
      execute: async ({ filter }) => {
        const rows = await projectRows(opts.projectId);
        if (!rows.some((r) => r.path === "package.json")) return { ok: false, error: "No package.json in this project." };
        const r = await long(() => sandbox(rows, "test", filter));
        log("tool.run_tests", { ok: r.ok && r.code === 0 });
        if (!r.ok) return { ok: false, error: r.error };
        if (r.out.includes("NO_TEST_RUNNER")) return { ok: false, error: "This project has no vitest in package.json, so there are no tests to run." };
        return { ok: r.code === 0, install: r.install === 0 ? "ok" : r.installTail.slice(-400), output: r.out.slice(-5000) };
      },
    }),
  };
  if (opts.readOnly) {
    const { search_code, fetch_url, probe_url, read_site_logs } = tools;
    return { search_code, fetch_url, probe_url, read_site_logs } as unknown as typeof tools;
  }
  return tools;
}
