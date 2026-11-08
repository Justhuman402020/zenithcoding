// Extra agent tools: real typecheck/tests in the E2B sandbox, code search,
// web page reading, live URL probing and real browser console logs.
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { TraceLogger } from "./trace.server";
import type { BuildCheckResult } from "./build-check";
import {
  canTypecheck, htmlToText, isBlockedUrl, parseTscOutput, readSandboxResult, sandboxScript,
  searchFiles, selectSandboxFiles, type ProjectFile,
} from "./agent-tools-policy";
import type { BrowserSession } from "./browser-session.server";
import type { ReaderRef } from "./browser-vision.server";
import {
  BROWSER_MAX_STEPS, browserKernelCode, browserStepSchema, hidePreviewToken, resolveTarget, validateSteps, withPath,
  type BrowserShot, type BrowserStep, type BrowserTarget,
} from "./browser-steps";

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

export type AgentBrowserOptions = {
  session: BrowserSession;
  userId: string;
  jobId?: string | null;
  goal?: string;
  /** Who reads the screenshots (resolved on first use). */
  reader: () => Promise<ReaderRef | null>;
};

async function saveBrowserShots(opts: { projectId: string; trace?: TraceLogger; browser: AgentBrowserOptions }, shots: BrowserShot[], report: string, readStatus: string, target: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const saved: Array<{ label: string; url: string }> = [];
  for (const [i, s] of shots.entries()) {
    const path = `${opts.browser.userId}/${opts.projectId}/agent-browser/${Date.now()}-${i}.jpg`;
    const bytes = Uint8Array.from(atob(s.b64), (c) => c.charCodeAt(0));
    const { error } = await supabaseAdmin.storage.from("browser-checks").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (!error) saved.push({ label: s.label, url: path });
  }
  if (!saved.length) return;
  await supabaseAdmin.from("browser_checks").insert({
    user_id: opts.browser.userId, project_id: opts.projectId, job_id: opts.browser.jobId || null, trace_id: opts.trace?.traceId,
    target, ok: false, visual_status: "browser", visual_phase: "Agent browser", capture_status: "captured",
    inspection_status: readStatus, visual_report: report.slice(0, 8000), screenshots: saved,
  } as any);
}

export function createAgentTools(opts: { projectId: string; origin: string; trace?: TraceLogger; readOnly?: boolean; keepAlive?: () => void; browser?: AgentBrowserOptions }) {
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
        if (opts.browser) {
          // Same warm browser as the browser tool, so this takes seconds after first use.
          const r = await long(() => opts.browser!.session.run(browserKernelCode({ steps: [{ action: "goto", url: target }], device: "phone", frame: false })));
          log("tool.read_site_logs", { url: target, ok: r.ok });
          if (!r.ok) return { ok: false, error: r.error };
          if (r.result.fatal) return { ok: false, error: r.result.fatal };
          const { console: c, pageErrors, failedRequests, title } = r.result;
          return { ok: true, url: target, console: c, pageErrors, failedRequests, title };
        }
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
    return { search_code, fetch_url, probe_url, read_site_logs } as unknown as typeof tools & ReturnType<typeof browserTools>;
  }
  return { ...tools, ...browserTools(opts, publishedUrl, long, log) };
}

function browserTools(
  opts: Parameters<typeof createAgentTools>[0],
  publishedUrl: () => Promise<string | null>,
  long: <T>(run: () => Promise<T>) => Promise<T>,
  log: (phase: string, detail: Record<string, unknown>) => void,
): Record<string, Tool> {
  const b = opts.browser;
  if (!b) return {};
  return {
    browser: tool({
      description: `Your own real Chrome browser (Playwright), open for the whole task. Use it any time to test like a person: open the project's newest files ("preview", default) or the live site ("published"), click, type, press keys, scroll, switch phone/desktop, read text, count elements, run JavaScript, and take screenshots (a vision model tells you what they show). Returns every step's result, console errors, page crashes, failed requests and the visible buttons/links/inputs. First use takes about a minute; after that a few seconds. Max ${BROWSER_MAX_STEPS} steps and 4 screenshots per call. Selectors: CSS, text=Sign in, or role=button[name="Sign in"]. Use it to reproduce a bug before fixing and to confirm the fix after editing; fix what it shows.`,
      inputSchema: z.object({
        url: z.string().max(2000).optional().describe('"preview" (newest files, default), "published", a path like "/about" on the published site, or a public https address'),
        device: z.enum(["phone", "desktop"]).optional(),
        steps: z.array(browserStepSchema).max(BROWSER_MAX_STEPS).describe("Run in order after the page opens. Empty = just open and report errors."),
        look_for: z.string().max(400).optional().describe("What the screenshot reader should check"),
      }),
      execute: async ({ url, device, steps, look_for }) => {
        const v = validateSteps(steps);
        if (!v.ok) return { ok: false, error: v.error };
        const { publicCaptureOrigin, mintPreviewUrl } = await import("./visual-check.server");
        const origin = publicCaptureOrigin(opts.origin);
        const ownHost = new URL(origin).hostname;
        let preview: { url: string; framework: boolean } | null = null;
        let published: string | null | undefined;
        const concrete = async (t: BrowserTarget) => {
          if (t.kind === "url") return { url: t.url, frame: false };
          if (t.kind === "published") {
            if (published === undefined) published = (await publishedUrl())?.replace(/^https?:\/\/[^/]+/, origin) ?? null;
            if (!published) throw new Error('This project isn\'t published yet. Open "preview" instead.');
            return { url: withPath(published, t.path), frame: false };
          }
          preview ??= await mintPreviewUrl({ projectId: opts.projectId, userId: b.userId, origin: opts.origin });
          return { url: preview.url, frame: preview.framework };
        };
        const plan: BrowserStep[] = [];
        let frame = false;
        let kind: BrowserTarget["kind"] = "preview";
        try {
          const queue = steps[0]?.action === "goto" ? steps : [{ action: "goto", url } as BrowserStep, ...steps];
          for (const s of queue) {
            if (s.action !== "goto") { plan.push(s); continue; }
            const t = resolveTarget(s.url, b.session.last, ownHost);
            if ("error" in t) return { ok: false, error: t.error };
            const c = await concrete(t);
            frame ||= c.frame; kind = t.kind; b.session.last = t;
            plan.push({ ...s, url: c.url });
          }
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not open that page." }; }
        log("tool.browser", { target: kind, steps: plan.length });
        const r = await long(() => b.session.run(browserKernelCode({ steps: plan, device: device ?? "phone", frame })));
        if (!r.ok) return { ok: false, error: `Browser unavailable: ${r.error}` };
        const res = r.result;
        if (res.fatal) return { ok: false, error: res.fatal };
        let seen = "";
        if (res.shots.length) {
          const reader = await b.reader().catch(() => null);
          let status = "unread";
          if (!reader) seen = "Screenshots saved, but nothing can read them: select an OpenRouter image reader in AI Models, or an Ollama model that sees images.";
          else {
            const rr = await long(async () => (await import("./browser-vision.server")).readScreenshots(reader, res.shots, { userId: b.userId, projectId: opts.projectId, goal: look_for ?? b.goal }));
            seen = rr.ok ? rr.text : rr.error;
            if (rr.ok) status = "read";
          }
          await saveBrowserShots({ projectId: opts.projectId, trace: opts.trace, browser: b }, res.shots, seen, status, kind).catch(() => {});
        }
        const ok = res.steps.every((s) => s.ok);
        log("tool.browser.done", { ok, shots: res.shots.length, errors: res.pageErrors.length, seconds: res.seconds });
        const out = {
          ok, opened: kind, url: res.url, title: res.title, steps: res.steps, consoleErrors: res.console, pageErrors: res.pageErrors,
          failedRequests: res.failedRequests, visibleControls: res.controls, stopped: res.stopped,
          screenshots: res.shots.map((s) => s.label), whatTheScreenshotsShow: seen || undefined, seconds: res.seconds,
          note: r.firstUse ? "Browser installed; next calls are fast." : undefined,
        };
        return JSON.parse(hidePreviewToken(JSON.stringify(out)));
      },
    }),
  };
}
