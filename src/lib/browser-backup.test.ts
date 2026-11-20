import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "./browser-check.server";
import { isScreenshotKey, pickActiveKey, screenshotOneUrl } from "./screenshot-key-policy";

const mocks = vi.hoisted(() => ({
  rows: [
    { id: "a", label: "First", base_url: "https://api.screenshotone.com", key_encrypted: "fixture-a" },
    { id: "b", label: "Second", base_url: "https://api.screenshotone.com", key_encrypted: "fixture-b" },
  ],
  active: "b" as string | null,
  upload: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: vi.fn((t: string) => t === "admin_brain"
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.active ? { content: mocks.active } : null }) }) }) }
    : { select: () => ({ order: async () => ({ data: mocks.rows, error: null }) }) }),
  storage: { from: () => ({ upload: mocks.upload }) },
} }));
vi.mock("./secrets-crypto.server", () => ({ decryptSecret: async (value: string) => value }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.active = "b"; });

const img = () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } });

describe("ScreenshotOne screenshot browser", () => {
  it("asks for the requested phone size", () => {
    const q = new URL(screenshotOneUrl("k", "https://x.test/p?a=1", { width: 390, height: 844 }, true)).searchParams;
    expect(q.get("url")).toBe("https://x.test/p?a=1");
    expect(q.get("viewport_width")).toBe("390");
    expect(q.get("viewport_mobile")).toBe("true");
  });
  it("only recognises ScreenshotOne keys", () => {
    expect(isScreenshotKey({ base_url: "https://api.screenshotone.com" })).toBe(true);
    expect(isScreenshotKey({ base_url: "https://api.screenshotone.com.evil.test" })).toBe(false);
    expect(isScreenshotKey({ base_url: "https://pro.microlink.io" })).toBe(false);
  });
  it("picks only the key that is turned on", () => {
    expect(pickActiveKey(mocks.rows, "b")?.label).toBe("Second");
    expect(pickActiveKey(mocks.rows, null)).toBeNull();
  });
  it("uses only the turned-on key for all three shots", async () => {
    const fetcher = vi.fn(async () => img());
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "u", projectId: "p", url: "https://site.test", published: true });
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every((c) => new URL(String((c as unknown[])[0])).searchParams.get("access_key") === "fixture-b")).toBe(true);
  });
  it("does not switch to another key when the turned-on key is used up", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "u", projectId: "p", url: "https://site.test", published: true });
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses to capture when no key is on", async () => {
    mocks.active = null;
    const fetcher = vi.fn(async () => img());
    vi.stubGlobal("fetch", fetcher);
    const result = await runCheck({ userId: "u", projectId: "p", url: "https://site.test", published: true });
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

import { screenshotOneUrl as shotUrl } from "./screenshot-key-policy";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("source preview capture waits", () => {
  i2("waits for the built preview frame before shooting", () => {
    const u = new URL(shotUrl("k", "https://boostallsocial.org/visual-preview/abc", { width: 390, height: 844 }, true));
    e2(u.searchParams.get("wait_for_selector")).toBe('iframe[title="Private project visual preview"]');
    e2(u.searchParams.get("delay")).toBe("5");
  });
});
