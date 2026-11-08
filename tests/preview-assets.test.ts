import { describe, expect, it } from "vitest";
import { assetKey, injectPreviewAssets, previewAssetMap } from "@/lib/preview-assets";

const files = [
  { path: "index.html", content: "<html></html>" },
  { path: "public/layers/m/sky.webp", content: "data:image/webp;base64,AAAA" },
  { path: "layers/d/earth.webp", content: "data:image/webp;base64,BBBB" },
];

describe("preview pictures", () => {
  it("finds public files however the site spells the address", () => {
    const map = previewAssetMap(files);
    expect(assetKey(map, "/layers/m/sky.webp")).toBe("layers/m/sky.webp");
    expect(assetKey(map, "public/layers/m/sky.webp")).toBe("layers/m/sky.webp");
    expect(assetKey(map, "https://boostallsocial.org/p/public/layers/d/earth.webp")).toBe("layers/d/earth.webp");
    expect(assetKey(map, "/layers/missing.webp")).toBeNull();
  });

  it("stops the browser from requesting project pictures from the wrong site", () => {
    const html = injectPreviewAssets(
      '<html><head><link rel="preload" href="/layers/m/sky.webp"></head><body><img src="/other.png"><a href="/layers/m/sky.webp">x</a></body></html>',
      files,
    );
    expect(html).toContain('data-ch-asset-href="/layers/m/sky.webp"');
    expect(html).toContain('<img src="/other.png">');
    expect(html).toContain('<a href="/layers/m/sky.webp">');
    const runtime = html.match(/<script data-ch-assets>([\s\S]*?)<\/script>/)![1];
    expect(() => new Function(runtime)).not.toThrow();
  });
});
