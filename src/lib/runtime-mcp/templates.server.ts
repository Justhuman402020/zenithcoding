import { withScrolltide } from "./scrolltide.server";
import type { MCPClient } from "@ai-sdk/mcp";

type Descriptor = Awaited<ReturnType<MCPClient["listTools"]>>["tools"][number];
export type TemplateResult = { id: string; title: string; description: string; source: string; preview: string | null };
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function valueText(row: Record<string, unknown>, names: string[]) { for (const name of names) { if (typeof row[name] === "string") return row[name] as string; } return ""; }
function safeUrl(value: string, image = false) {
  try { const u = new URL(value, "https://www.scrolltide.co"); return u.protocol === "https:" && (image || u.hostname === "www.scrolltide.co" || u.hostname === "scrolltide.co") ? u.href : ""; } catch { return ""; }
}
async function definitions(client: MCPClient) {
  const list: Descriptor[] = []; let cursor: string | undefined;
  do { const page = await client.listTools({ params: cursor ? { cursor } : undefined }); list.push(...page.tools); cursor = page.nextCursor; } while (cursor && list.length < 100);
  return list;
}
function selectTool(tools: Descriptor[], kind: "search" | "detail") {
  const candidates = tools.filter(t => t.annotations?.readOnlyHint !== false && t.annotations?.destructiveHint !== true && !/delete|pay|billing|send|publish|write|update|create/i.test(t.name) && (kind === "search" ? /search/i : /get|fetch|read|detail/i).test(`${t.name} ${t.description ?? ""}`) && /template|library|prompt|item|section/i.test(`${t.name} ${t.description ?? ""}`));
  const tool = candidates.find(t => kind === "search" ? /search/i.test(t.name) : /prompt|detail/i.test(t.name)) ?? candidates[0];
  if (!tool) throw new Error(`Scrolltide did not advertise a supported ${kind} tool.`);
  return tool;
}
function argsFor(tool: Descriptor, kind: "search" | "detail", input: string, cursor?: string) {
  const properties = object(tool.inputSchema.properties) ?? {};
  const names = Object.keys(properties);
  const field = names.find(n => kind === "search" ? /^(query|search|q|search_query)$/i.test(n) : /^(id|slug|template_id|item_id|templateId|itemId|prompt_id)$/i.test(n));
  if (!field) throw new Error("Scrolltide’s tool format needs review before use.");
  const args: Record<string, unknown> = { [field]: input };
  const cursorField = names.find(n => /^(cursor|next_cursor)$/i.test(n));
  if (cursor && cursorField) args[cursorField] = cursor;
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  if (required.some(n => typeof n === "string" && !(n in args))) throw new Error("Scrolltide requires additional search options. Its tool format needs review.");
  return { args, supportsCursor: Boolean(cursorField) };
}
function decoded(result: Awaited<ReturnType<MCPClient["callTool"]>>) {
  if (result.isError) throw new Error("Scrolltide rejected the request. Check your subscription or daily allowance.");
  if (result.structuredContent) return result.structuredContent;
  const content: unknown[] = Array.isArray(result.content) ? result.content : [];
  const text = content.map(c => { const row = object(c); return row?.type === "text" && typeof row.text === "string" ? row.text : ""; }).filter(Boolean).join("\n");
  try { return JSON.parse(text) as unknown; } catch { return text; }
}
export async function searchTemplates(userId: string, query: string, cursor?: string) {
  return withScrolltide(userId, async client => {
    const tool = selectTool(await definitions(client), "search");
    const { args, supportsCursor } = argsFor(tool, "search", query, cursor);
    const data = decoded(await client.callTool({ name: tool.name, arguments: args }));
    const root = object(data);
    const raw = Array.isArray(data) ? data : root?.items ?? root?.templates ?? root?.results ?? root?.data;
    if (!Array.isArray(raw)) return { items: [] as TemplateResult[], nextCursor: null, note: typeof data === "string" ? data.slice(0, 12000) : "Scrolltide returned a catalog format that needs review." };
    const items = raw.flatMap(item => {
      const row = object(item); if (!row) return [];
      const id = valueText(row, ["id", "slug", "template_id", "item_id"]);
      const title = valueText(row, ["title", "name"]);
      if (!id || !title) return [];
      return [{ id, title, description: valueText(row, ["description", "summary", "category"]), source: safeUrl(valueText(row, ["url", "source_url", "link"])) || "https://www.scrolltide.co", preview: safeUrl(valueText(row, ["preview_url", "thumbnail", "image_url", "image"]), true) || null }];
    });
    const next = root ? valueText(root, ["nextCursor", "next_cursor"]) : "";
    return { items, nextCursor: supportsCursor && next ? next : null, note: "" };
  });
}
export async function fetchTemplate(userId: string, id: string) {
  return withScrolltide(userId, async client => {
    const tool = selectTool(await definitions(client), "detail");
    const { args } = argsFor(tool, "detail", id);
    const data = decoded(await client.callTool({ name: tool.name, arguments: args }));
    const root = object(data); const row = root && object(root.template ?? root.item ?? root.data) || root;
    const brief = typeof data === "string" ? data : row ? valueText(row, ["rebuild_prompt", "rebuildPrompt", "prompt", "instructions", "content", "full_prompt"]) : "";
    if (!brief) throw new Error("Scrolltide did not return rebuild instructions in a supported format.");
    if (brief.length > 200000) throw new Error("This template is too large to load safely.");
    return { id, title: row ? valueText(row, ["title", "name"]) || id : id, source: row ? safeUrl(valueText(row, ["url", "source_url", "link"])) || "https://www.scrolltide.co" : "https://www.scrolltide.co", brief };
  });
}