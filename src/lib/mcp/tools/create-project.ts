import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_project",
  title: "Create project",
  description: "Create a new empty Code Haven project for the signed-in user.",
  inputSchema: {
    name: z.string().trim().min(1).max(120).describe("Project name."),
    description: z.string().trim().max(600).optional().describe("Short description."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ name, description }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("projects")
      .insert({ user_id: ctx.getUserId(), name, description: description ?? null })
      .select("id, name")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const project = { id: data.id as string, name: data.name as string };
    return { content: [{ type: "text", text: `Created project ${project.name} (${project.id})` }], structuredContent: { project } };
  },
});
