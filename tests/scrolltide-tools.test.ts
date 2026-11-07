import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ listTools: vi.fn(), callTool: vi.fn() }));
const catalog = vi.hoisted(() => ({ browseCatalog: vi.fn() }));
vi.mock("../src/lib/runtime-mcp/scrolltide.server", () => ({ withScrolltide: async (_user: string, work: (client: typeof mock) => unknown) => work(mock), connectionFor: async () => ({ state: "ready" }) }));
vi.mock("../src/lib/runtime-mcp/catalog.server", () => catalog);
import { fetchTemplate, searchTemplates } from "../src/lib/runtime-mcp/templates.server";
describe("advertised Scrolltide tools", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("uses the real advertised search name and schema without fetching full prompts", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "search_library", description: "Search template library", inputSchema: { properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } }] });
    mock.callTool.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ items: [{ id: "a", title: "Portfolio", description: "Grid", url: "https://www.scrolltide.co/templates/a" }] }) }] });
    const r = await searchTemplates("owner", "portfolio");
    expect(mock.callTool).toHaveBeenCalledExactlyOnceWith({ name: "search_library", arguments: { query: "portfolio" } });
    expect(r.items[0].id).toBe("a");
  });
  it("never selects a destructive advertised tool", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "delete_template", description: "Fetch a template", inputSchema: { properties: { id: {} } }, annotations: { destructiveHint: true } }] });
    await expect(fetchTemplate("owner", "a")).rejects.toThrow();
    expect(mock.callTool).not.toHaveBeenCalled();
  });
  it("keeps real fetched instructions unchanged", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "get_prompt", description: "Get full template rebuild prompt", inputSchema: { properties: { slug: {} }, required: ["slug"] }, annotations: { readOnlyHint: true } }] });
    mock.callTool.mockResolvedValue({ structuredContent: { title: "Portfolio", prompt: "Build a project grid with 3 columns." }, content: [] });
    expect((await fetchTemplate("owner", "portfolio")).brief).toBe("Build a project grid with 3 columns.");
  });
  it("does not call tools whose required parameters are unsupported", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "search_library", description: "Search template library", inputSchema: { properties: { query: {}, secret: {} }, required: ["query", "secret"] } }] });
    await expect(searchTemplates("owner", "portfolio")).rejects.toThrow();
    expect(mock.callTool).not.toHaveBeenCalled();
  });
  it("browses the full library from public shelves without any Scrolltide tool call", async () => {
    catalog.browseCatalog.mockResolvedValueOnce({ items: [{ id: "a", title: "A" }], nextCursor: "codehaven-shelf:1", note: "" }).mockResolvedValueOnce({ items: [{ id: "b", title: "B" }], nextCursor: null, note: "" });
    const first = await searchTemplates("owner", "");
    const second = await searchTemplates("owner", "", first.nextCursor ?? undefined);
    expect(second.items[0].id).toBe("b");
    expect(catalog.browseCatalog).toHaveBeenLastCalledWith("codehaven-shelf:1");
    expect(mock.listTools).not.toHaveBeenCalled();
    expect(mock.callTool).not.toHaveBeenCalled();
  });
  it("stops a repeated result cursor", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "search_templates", inputSchema: { properties: { query: {}, cursor: {} } } }] });
    mock.callTool.mockResolvedValue({ structuredContent: { items: [{ id: "a", title: "A" }], nextCursor: "same" } });
    expect((await searchTemplates("owner", "x", "same")).nextCursor).toBeNull();
  });
});