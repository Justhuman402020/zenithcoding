import { afterEach, describe, expect, it, vi } from "vitest";
import { browseCatalog, parseCatalog } from "../src/lib/runtime-mcp/catalog.server";
describe("full library summaries", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves Scrolltide video previews instead of treating them as thumbnails", () => {
    const url = "https://pub-1e5b4001b36b47e28e6a2fb775966a79.r2.dev/previews/selene.mp4";
    const poster = url.replace(".mp4", "-poster.jpg");
    const media = JSON.stringify([1, `10:${JSON.stringify({ previewVideo: url, posterImage: poster })}\n`]);
    const items = parseCatalog(`<a href="/templates/selene"><video><source src="${url}" type="video/mp4"></video><h3>SELENE</h3></a><script>self.__next_f.push(${media})</script>`, "templates");
    expect(items[0].preview).toBe(url);
    expect(items[0].poster).toBe(poster);
  });
  it("does not cap the public template library at 50 results", () => {
    const html = Array.from({ length: 132 }, (_, i) => `<a href="/templates/item-${i}"><h3>Item ${i}</h3><p>Description</p></a>`).join("");
    expect(parseCatalog(html, "templates")).toHaveLength(132);
  });
  it("uses the real shelf slug, not the preview filename, for instructions", () => {
    const record = JSON.stringify({ items: [{ slug: "scroll-key", name: "Scroll Key", kind: "component", previewVideo: "https://media.example/scroll-key-v2.mp4" }] });
    const html = `<script>self.__next_f.push(${JSON.stringify([1, `10:${record}\n`])})</script>`;
    expect(parseCatalog(html, "components")[0].id).toBe("scroll-key");
  });
  it("loads all five shelves without any prompt retrieval", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const shelf = url.split("/").pop();
      const row = { slug: shelf, name: shelf, kind: shelf };
      const html = shelf === "templates" ? '<a href="/templates/a"><h3>A</h3></a>' : `<script>self.__next_f.push(${JSON.stringify([1, `10:${JSON.stringify({ items: [row] })}\n`])})</script>`;
      return new Response(html);
    });
    vi.stubGlobal("fetch", fetchMock);
    let cursor: string | undefined; let count = 0;
    do { const result = await browseCatalog(cursor); count += result.items.length; cursor = result.nextCursor ?? undefined; } while (cursor);
    expect(count).toBe(5);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["templates", "components", "sections", "ui", "shaders"].map(shelf => `https://www.scrolltide.co/${shelf}`));
  });
});