// Pure rules for the agent's real Playwright browser: step shape, limits,
// which addresses it may open, and the Python runner it sends to the sandbox.
import { z } from "zod";
import { isBlockedUrl } from "./agent-tools-policy";

export const BROWSER_MAX_STEPS = 40;
export const BROWSER_MAX_SHOTS = 4;
/** Seconds one browser call may run before it stops and reports. */
export const BROWSER_RUN_SECONDS = 180;
export const BROWSER_IDLE_SECONDS = 600;
export const PREVIEW_FRAME_SELECTOR = 'iframe[title="Private project visual preview"]';

export const BROWSER_ACTIONS = ["goto", "click", "fill", "press", "select", "hover", "scroll", "wait", "wait_for", "viewport", "screenshot", "read_text", "count", "eval"] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

// Flat on purpose: small local models fill a flat object far more reliably than a union.
export const browserStepSchema = z.object({
  action: z.enum(BROWSER_ACTIONS),
  selector: z.string().max(300).optional().describe('CSS selector, or text=Sign in, or role=button[name="Sign in"]'),
  value: z.string().max(2000).optional().describe("Text to type (fill) or option to choose (select)"),
  key: z.string().max(40).optional().describe("Key for press, e.g. Enter, Tab, Escape"),
  url: z.string().max(2000).optional().describe('For goto: "preview", "published", a path like "/about", or a public https address'),
  ms: z.number().int().min(0).max(30_000).optional(),
  y: z.number().int().min(-20_000).max(20_000).optional(),
  device: z.enum(["phone", "desktop"]).optional(),
  label: z.string().max(60).optional(),
  full_page: z.boolean().optional(),
  script: z.string().max(4000).optional().describe("For eval: a JavaScript expression or () => {...} run inside the page"),
  state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
});
export type BrowserStep = z.infer<typeof browserStepSchema>;

const NEEDS: Partial<Record<BrowserAction, Array<keyof BrowserStep>>> = {
  goto: ["url"], click: ["selector"], fill: ["selector", "value"], press: ["key"], select: ["selector", "value"],
  hover: ["selector"], wait: ["ms"], wait_for: ["selector"], viewport: ["device"], count: ["selector"], eval: ["script"],
};

/** Checks every step has what its action needs and the call stays inside the limits. */
export function validateSteps(steps: BrowserStep[]): { ok: true } | { ok: false; error: string } {
  if (steps.length > BROWSER_MAX_STEPS) return { ok: false, error: `At most ${BROWSER_MAX_STEPS} steps per browser call; split the test into smaller calls.` };
  const shots = steps.filter((s) => s.action === "screenshot").length;
  if (shots > BROWSER_MAX_SHOTS) return { ok: false, error: `At most ${BROWSER_MAX_SHOTS} screenshots per browser call.` };
  for (const [i, s] of steps.entries()) {
    const missing = (NEEDS[s.action] ?? []).filter((k) => s[k] === undefined || s[k] === "");
    if (missing.length) return { ok: false, error: `Step ${i + 1} (${s.action}) needs ${missing.join(" and ")}.` };
    if (s.action === "wait" && (s.ms ?? 0) > 10_000) return { ok: false, error: `Step ${i + 1}: wait is at most 10000 ms.` };
  }
  return { ok: true };
}

export type BrowserTarget = { kind: "preview"; path: string } | { kind: "published"; path: string } | { kind: "url"; url: string };

/** Turns what the agent asked to open into a target, or explains why it may not open it. */
export function resolveTarget(raw: string | undefined, last: BrowserTarget | null, ownHost: string): BrowserTarget | { error: string } {
  const v = (raw ?? "").trim();
  if (!v) return last ?? { kind: "preview", path: "" };
  const lower = v.toLowerCase();
  if (lower === "preview" || lower === "latest") return { kind: "preview", path: "" };
  if (lower === "published" || lower === "live") return { kind: "published", path: "" };
  if (v.startsWith("/")) {
    // A path stays on whatever the agent opened last.
    if (last?.kind === "url") return { kind: "url", url: new URL(v, last.url).toString() };
    if (last?.kind === "published") return { kind: "published", path: v.slice(0, 500) };
    return { error: 'The private preview always opens on its first page. Open "preview" and click the link to that page, or use "published" + a path.' };
  }
  if (isBlockedUrl(v)) return { error: 'Only "preview", "published", a path like "/about", or a public https address can be opened.' };
  const u = new URL(v);
  if (u.hostname.toLowerCase() === ownHost.toLowerCase() && !/^\/(s\/|visual-preview\/|api\/public\/preview\/)/.test(u.pathname)) {
    return { error: "Code Haven's own pages can't be opened. Use \"preview\" for the newest files or \"published\" for the live site." };
  }
  return { kind: "url", url: u.toString() };
}

/** Joins a path onto the published site address. */
export function withPath(base: string, path: string) {
  if (!path) return base;
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}

const RUNNER = String.raw`
import json, sys, base64, os, time
from playwright.sync_api import sync_playwright
cfg = json.load(open(sys.argv[1]))
STATE = "/tmp/ch_state.json"
FRAME = cfg["frame"]
VIEW = {"phone": {"width": 390, "height": 844}, "desktop": {"width": 1280, "height": 900}}
out = {"steps": [], "console": [], "pageErrors": [], "failedRequests": [], "shots": []}
start = time.time()
def add(key, text):
    if len(out[key]) < 40: out[key].append(str(text)[:400])
def save():
    out["seconds"] = round(time.time() - start, 1)
    json.dump(out, open("/tmp/ch_out.json", "w"))
with sync_playwright() as p:
    b = p.chromium.launch()
    phone = cfg.get("device", "phone") == "phone"
    ctx = b.new_context(viewport=VIEW["phone" if phone else "desktop"], is_mobile=phone, has_touch=phone, storage_state=STATE if os.path.exists(STATE) else None)
    page = ctx.new_page()
    page.on("console", lambda m: add("console", m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: add("pageErrors", e))
    page.on("requestfailed", lambda r: add("failedRequests", r.method + " " + r.url[:200] + " " + str(r.failure)))
    page.on("response", lambda r: add("failedRequests", str(r.status) + " " + r.url[:200]) if r.status >= 400 else None)
    def scope():
        if FRAME:
            try:
                h = page.locator(FRAME).first.element_handle(timeout=1000)
                f = h.content_frame() if h else None
                if f: return f
            except Exception:
                pass
        return page
    def ready():
        if FRAME:
            try:
                page.wait_for_selector(FRAME, timeout=40000)
                scope().wait_for_load_state("load", timeout=20000)
            except Exception as e:
                add("pageErrors", "preview did not finish building: " + str(e).split("\n")[0][:200])
        try: page.wait_for_load_state("networkidle", timeout=8000)
        except Exception: pass
        page.wait_for_timeout(1200)
    T = 10000
    for i, s in enumerate(cfg["steps"]):
        if time.time() - start > cfg["budget"]:
            out["stopped"] = "Time limit reached before step %d" % (i + 1)
            break
        a = s["action"]; r = {"step": i + 1, "action": a}
        sel = s.get("selector")
        try:
            sc = scope()
            if a == "goto":
                page.goto(s["url"], wait_until="load", timeout=45000); ready()
            elif a == "click": sc.locator(sel).first.click(timeout=T); page.wait_for_timeout(600)
            elif a == "fill": sc.locator(sel).first.fill(s.get("value", ""), timeout=T)
            elif a == "press":
                if sel: sc.locator(sel).first.press(s["key"], timeout=T)
                else: page.keyboard.press(s["key"])
                page.wait_for_timeout(400)
            elif a == "select": sc.locator(sel).first.select_option(s.get("value", ""), timeout=T)
            elif a == "hover": sc.locator(sel).first.hover(timeout=T)
            elif a == "scroll": sc.evaluate("y => window.scrollBy(0, y)", s.get("y", 600)); page.wait_for_timeout(300)
            elif a == "wait": page.wait_for_timeout(min(int(s.get("ms", 1000)), 10000))
            elif a == "wait_for": sc.locator(sel).first.wait_for(state=s.get("state", "visible"), timeout=min(int(s.get("ms", 10000)), 30000))
            elif a == "viewport": page.set_viewport_size(VIEW[s["device"]]); page.wait_for_timeout(500)
            elif a == "screenshot":
                img = page.screenshot(type="jpeg", quality=60, full_page=bool(s.get("full_page")))
                out["shots"].append({"label": s.get("label") or ("Step %d" % (i + 1)), "b64": base64.b64encode(img).decode()})
            elif a == "read_text":
                r["text"] = (sc.locator(sel).first.inner_text(timeout=T) if sel else sc.locator("body").inner_text(timeout=T))[:4000]
            elif a == "count": r["count"] = sc.locator(sel).count()
            elif a == "eval": r["value"] = json.dumps(sc.evaluate(s["script"]), default=str)[:4000]
            r["ok"] = True
        except Exception as e:
            r["ok"] = False; r["error"] = str(e).split("\n")[0][:300]
        out["steps"].append(r)
        save()
    try:
        sc = scope()
        out["title"] = sc.title() if hasattr(sc, "title") else page.title()
        out["url"] = page.url
        out["controls"] = sc.evaluate("""() => [...document.querySelectorAll('a,button,input,select,textarea,[role=button]')].filter(e => e.offsetParent !== null).slice(0, 40).map(e => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('name') ? '[name=' + e.getAttribute('name') + ']' : '') + ' ' + (e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('aria-label') || '').trim().slice(0, 60)))""")
    except Exception as e:
        add("pageErrors", "could not read page: " + str(e).split("\n")[0][:200])
    try: ctx.storage_state(path=STATE)
    except Exception: pass
    b.close()
save()
`;

/** Kernel code: installs Playwright once per sandbox, then runs the steps in a fresh browser process. */
export function browserKernelCode(cfg: { steps: BrowserStep[]; device: "phone" | "desktop"; frame: boolean; budget?: number }) {
  const payload = JSON.stringify({ steps: cfg.steps, device: cfg.device, frame: cfg.frame ? PREVIEW_FRAME_SELECTOR : "", budget: cfg.budget ?? BROWSER_RUN_SECONDS - 20 });
  return `import subprocess, json, os, sys
open("/tmp/ch_steps.json", "w").write(${JSON.stringify(payload)})
open("/tmp/ch_runner.py", "w").write(${JSON.stringify(RUNNER)})
fatal = None
if not os.path.exists("/tmp/ch_pw_ready"):
    r = subprocess.run(f"{sys.executable} -m pip install -q playwright && {sys.executable} -m playwright install --with-deps chromium", shell=True, capture_output=True, text=True, timeout=300)
    if r.returncode == 0: open("/tmp/ch_pw_ready", "w").write("1")
    else: fatal = "Browser install failed: " + (r.stderr or r.stdout)[-400:]
if fatal is None:
    if os.path.exists("/tmp/ch_out.json"): os.remove("/tmp/ch_out.json")
    try:
        r = subprocess.run([sys.executable, "/tmp/ch_runner.py", "/tmp/ch_steps.json"], capture_output=True, text=True, timeout=${BROWSER_RUN_SECONDS})
        if not os.path.exists("/tmp/ch_out.json"): fatal = "Browser stopped: " + (r.stderr or r.stdout)[-500:]
    except subprocess.TimeoutExpired:
        if not os.path.exists("/tmp/ch_out.json"): fatal = "Browser call hit the ${BROWSER_RUN_SECONDS}s limit."
print("@@RESULT@@" + (json.dumps({"fatal": fatal}) if fatal else open("/tmp/ch_out.json").read()))`;
}

export type BrowserShot = { label: string; b64: string };
export type BrowserRunResult = {
  fatal?: string; steps: Array<{ step: number; action: string; ok: boolean; error?: string; text?: string; count?: number; value?: string }>;
  console: string[]; pageErrors: string[]; failedRequests: string[]; shots: BrowserShot[];
  title?: string; url?: string; controls?: string[]; stopped?: string; seconds?: number;
};

export function readBrowserResult(stdout: string): BrowserRunResult | null {
  const i = stdout.lastIndexOf("@@RESULT@@");
  if (i < 0) return null;
  try {
    const raw = JSON.parse(stdout.slice(i + 10).trim()) as Partial<BrowserRunResult>;
    return { steps: [], console: [], pageErrors: [], failedRequests: [], shots: [], ...raw };
  } catch { return null; }
}

/** Hides private one-time preview addresses before anything reaches the model or the log. */
export function hidePreviewToken(text: string) {
  return text.replace(/\/(visual-preview|api\/public\/preview)\/[a-f0-9]{32,}/gi, "/$1/[private]");
}
