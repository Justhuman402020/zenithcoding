import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { unpackZip } from "@/lib/zip-import";
import { previewAssetMap, assetKey } from "@/lib/preview-assets";

vi.mock("esbuild-wasm", async () => {
  const native = await import("esbuild");
  return { ...native, initialize: async () => {} };
});
import { buildInBrowser } from "@/lib/browser-build";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=";
const bytes = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));

describe("ZIP pictures through preview build", () => {
  it("keeps original imported image bytes instead of encoding their URL as image bytes", async () => {
    const archive = zipSync({
      "other-template/package.json": strToU8("{}"),
      "other-template/index.html": strToU8('<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>'),
      "other-template/src/main.ts": strToU8('import picture from "./assets/picture.png"; document.body.innerHTML = `<img src="${picture}">`;'),
      "other-template/src/assets/picture.png": bytes,
      "other-template/images/background.png": bytes,
      "other-template/public/images/cover.png": bytes,
    });
    const unpacked = await unpackZip(new File([archive], "other-template.zip"));
    expect(unpacked.skipped).toBe(0);
    const result = await buildInBrowser(unpacked.files);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const js = result.files.find(f => f.path.endsWith(".js"));
    expect(js?.content).toContain(`data:image/png;base64,${pixel}`);
    const map = previewAssetMap(result.files);
    expect(map["images/background.png"]).toBe(`data:image/png;base64,${pixel}`);
    expect(map["images/cover.png"]).toBe(`data:image/png;base64,${pixel}`);
    expect(assetKey(map, "/p/images%2Fcover.png")).toBe("images/cover.png");
  });

  it("does not silently discard a picture larger than four megabytes", async () => {
    const image = new Uint8Array(4_000_001); image.set(bytes);
    const archive = zipSync({ "index.html": strToU8("<html></html>"), "public/large.png": image });
    const result = await unpackZip(new File([archive], "large-picture.zip"));
    const picture = result.files.find(f => f.path === "public/large.png");
    expect(result.skipped).toBe(0);
    expect(picture?.content.startsWith("data:image/png;base64,")).toBe(true);
    expect(atob(picture?.content.split(",")[1] ?? "").length).toBe(4_000_001);
  });
});