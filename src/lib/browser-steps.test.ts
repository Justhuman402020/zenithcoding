import { describe, expect, it } from "vitest";
import { browserKernelCode, hidePreviewToken, readBrowserResult, resolveTarget, validateSteps, withPath, type BrowserStep } from "./browser-steps";

const HOST = "boostallsocial.org";

describe("agent browser rules", () => {
  it("allows at most 40 steps per call", () => {
    const steps = Array.from({ length: 41 }, () => ({ action: "wait", ms: 10 }) as BrowserStep);
    expect(validateSteps(steps).ok).toBe(false);
    expect(validateSteps(steps.slice(0, 40)).ok).toBe(true);
  });
  it("allows at most 4 screenshots per call", () => {
    const shots = Array.from({ length: 5 }, () => ({ action: "screenshot" }) as BrowserStep);
    expect(validateSteps(shots).ok).toBe(false);
    expect(validateSteps(shots.slice(0, 4)).ok).toBe(true);
  });
  it("names what a step is missing", () => {
    const r = validateSteps([{ action: "fill", selector: "#email" }]);
    expect(r).toEqual({ ok: false, error: "Step 1 (fill) needs value." });
  });
  it("opens the newest files by default", () => {
    expect(resolveTarget(undefined, null, HOST)).toEqual({ kind: "preview", path: "" });
    expect(resolveTarget("published", null, HOST)).toEqual({ kind: "published", path: "" });
  });
  it("never opens private or plain-http addresses", () => {
    for (const u of ["http://example.com", "https://localhost/x", "https://10.0.0.5/", "https://192.168.1.2/"]) {
      expect("error" in resolveTarget(u, null, HOST)).toBe(true);
    }
    expect(resolveTarget("https://example.com/a", null, HOST)).toEqual({ kind: "url", url: "https://example.com/a" });
  });
  it("never opens Code Haven's own app pages, only project pages", () => {
    expect("error" in resolveTarget("https://boostallsocial.org/admin", null, HOST)).toBe(true);
    expect(resolveTarget("https://boostallsocial.org/s/my-site", null, HOST)).toEqual({ kind: "url", url: "https://boostallsocial.org/s/my-site" });
  });
  it("keeps a path on the page opened last", () => {
    expect(resolveTarget("/about", { kind: "url", url: "https://example.com/a" }, HOST)).toEqual({ kind: "url", url: "https://example.com/about" });
    expect(resolveTarget("/about", { kind: "published", path: "" }, HOST)).toEqual({ kind: "published", path: "/about" });
    expect(withPath("https://x.org/s/site", "/about")).toBe("https://x.org/s/site/about");
  });
  it("hides private preview addresses from the model", () => {
    const t = "a".repeat(64);
    expect(hidePreviewToken(`https://x.org/visual-preview/${t} failed`)).toBe("https://x.org/visual-preview/[private] failed");
  });
  it("installs the browser once per sandbox and reads its result", () => {
    const code = browserKernelCode({ steps: [{ action: "goto", url: "https://example.com" }], device: "phone", frame: false });
    expect(code).toContain('if not os.path.exists("/tmp/ch_pw_ready")');
    expect(readBrowserResult('noise@@RESULT@@{"steps":[{"step":1,"action":"goto","ok":true}]}')?.steps[0]?.ok).toBe(true);
    expect(readBrowserResult("nothing")).toBeNull();
  });
});
