import { afterEach, describe, expect, it, vi } from "vitest";
import { browseCatalog, parseCatalog } from "../src/lib/runtime-mcp/catalog.server";
describe("full library summaries", () => {
  afterEach(() => vi.unstubAllGlobals());
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