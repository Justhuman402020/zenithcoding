import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ listTools: vi.fn(), callTool: vi.fn() }));
vi.mock("../src/lib/runtime-mcp/scrolltide.server", () => ({ withScrolltide: async (_user: string, work: (client: typeof mock) => unknown) => work(mock) }));
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
  it("browses all summaries with no search term and never retrieves instructions", async () => {
    mock.listTools.mockResolvedValue({ tools: [
      { name: "list_templates", inputSchema: { properties: { cursor: {} } }, annotations: { readOnlyHint: true } },
      { name: "get_prompt", description: "Get full template instructions", inputSchema: { properties: { id: {} } } },
    ] });
    mock.callTool.mockResolvedValueOnce({ structuredContent: { items: [{ id: "a", title: "A" }], nextCursor: "second" } }).mockResolvedValueOnce({ structuredContent: { items: [{ id: "b", title: "B" }] } });
    const first = await searchTemplates("owner", "");
    const second = await searchTemplates("owner", "", first.nextCursor ?? undefined);
    expect(first.items.map(i => i.id)).toEqual(["a"]);
    expect(second.items.map(i => i.id)).toEqual(["b"]);
    expect(mock.callTool.mock.calls).toEqual([[{ name: "list_templates", arguments: {} }], [{ name: "list_templates", arguments: { cursor: "second" } }]]);
  });
  it("supports empty-query catalog searches", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "list_categories", description: "All categories in the template library", inputSchema: { properties: {} } }, { name: "search_library", inputSchema: { properties: { query: {} }, required: ["query"] } }] });
    mock.callTool.mockResolvedValue({ structuredContent: { items: [] } });
    await searchTemplates("owner", "");
    expect(mock.callTool).toHaveBeenCalledWith({ name: "search_library", arguments: { query: "" } });
  });
  it("keeps numbered catalog pages available", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "browse_templates", inputSchema: { properties: { page: { type: "integer", minimum: 1 } } } }] });
    mock.callTool.mockResolvedValueOnce({ structuredContent: { items: [{ id: "a", title: "A" }], pagination: { totalPages: 2 } } }).mockResolvedValueOnce({ structuredContent: { items: [{ id: "b", title: "B" }], pagination: { totalPages: 2 } } });
    const first = await searchTemplates("owner", "");
    const second = await searchTemplates("owner", "", first.nextCursor ?? undefined);
    expect(mock.callTool).toHaveBeenLastCalledWith({ name: "browse_templates", arguments: { page: 2 } });
    expect(second.nextCursor).toBeNull();
  });
  it("stops a repeated result cursor", async () => {
    mock.listTools.mockResolvedValue({ tools: [{ name: "list_templates", inputSchema: { properties: { cursor: {} } } }] });
    mock.callTool.mockResolvedValue({ structuredContent: { items: [{ id: "a", title: "A" }], nextCursor: "same" } });
    expect((await searchTemplates("owner", "", "same")).nextCursor).toBeNull();
  });
});