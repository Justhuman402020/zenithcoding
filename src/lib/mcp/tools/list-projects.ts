import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "List projects",
  description: "List the signed-in user's Code Haven projects, newest first.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("projects")
      .select("id, name, description, slug, published, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const projects = (data ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      description: (p.description as string | null) ?? null,
      slug: (p.slug as string | null) ?? null,
      published: Boolean(p.published),
      updated_at: String(p.updated_at),
    }));
    return { content: [{ type: "text", text: JSON.stringify(projects) }], structuredContent: { projects } };
  },
});
