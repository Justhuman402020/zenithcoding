import { afterEach, describe, expect, it, vi } from "vitest";
import { microlinkScreenshotUrl, runCheck } from "./browser-check.server";
import { isScreenshotKey } from "./screenshot-key-policy";

const mocks = vi.hoisted(() => ({
  rows: [
    { label: "First screenshot", base_url: "https://pro.microlink.io", key_encrypted: "test-fixture-a" },
    { label: "Second screenshot", base_url: "https://pro.microlink.io", key_encrypted: "test-fixture-b" },
  ],
  upload: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: vi.fn(() => ({ select: () => ({ order: async () => ({ data: mocks.rows, error: null }) }) })),
  storage: { from: () => ({ upload: mocks.upload }) },
} }));
vi.mock("./secrets-crypto.server", () => ({ decryptSecret: async (value: string) => value }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Microlink screenshot browser", () => {
  it("uses the free endpoint without a key and the pro endpoint with one", () => {
    expect(microlinkScreenshotUrl("https://x.test", { width: 390, height: 844 }, true, false)).toMatch(/^https:\/\/api\.microlink\.io\//);
    expect(microlinkScreenshotUrl("https://x.test", { width: 390, height: 844 }, true, true)).toMatch(/^https:\/\/pro\.microlink\.io\//);
  });
  it("asks for an image at the requested phone size", () => {
    const q = new URL(microlinkScreenshotUrl("https://x.test/p?a=1", { width: 390, height: 844 }, true, false)).searchParams;
    expect(q.get("url")).toBe("https://x.test/p?a=1");
    expect(q.get("viewport.width")).toBe("390");
    expect(q.get("viewport.isMobile")).toBe("true");
    expect(q.get("embed")).toBe("screenshot.url");
  });
  it("only uses explicitly saved Microlink Brain keys", () => {
    expect(isScreenshotKey({ base_url: "https://pro.microlink.io" })).toBe(true);
    expect(isScreenshotKey({ base_url: "https://pro.microlink.io.evil.test" })).toBe(false);
    expect(isScreenshotKey({ base_url: "https://api.cloudflare.com" })).toBe(false);
  });
  it("switches to the next key on exhaustion and keeps it for subsequent shots without Cloudflare", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("x-api-key");
      return key === "test-fixture-a" ? new Response(null, { status: 429 }) : new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "user", projectId: "project", url: "https://site.test", published: true });
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every(([url]) => new URL(url).hostname === "pro.microlink.io")).toBe(true);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    if (result.ok) expect(result.shots).toHaveLength(3);
  });
  it("stops after all saved keys are exhausted", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "user", projectId: "project", url: "https://site.test", published: true });
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not change keys for a page failure", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "user", projectId: "project", url: "https://site.test", published: true });
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
