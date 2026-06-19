import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        const projectId = request.headers.get("x-project-id");
        if (!token) return new Response("Unauthorized", { status: 401 });
        if (!projectId) return new Response("Missing project", { status: 400 });

        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!lovableKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const supabase = createClient(supabaseUrl, supabasePublishable, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        // confirm project belongs to user
        const { data: proj } = await supabase
          .from("projects")
          .select("id,name")
          .eq("id", projectId)
          .maybeSingle();
        if (!proj) return new Response("Project not found", { status: 404 });

        const body = (await request.json()) as { messages?: UIMessage[] };
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }

        const gateway = createLovableAiGatewayProvider(lovableKey);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = {
          list_files: tool({
            description: "List all files in the current project.",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase
                .from("files")
                .select("path")
                .eq("project_id", projectId)
                .order("path");
              return { files: (data ?? []).map((f) => f.path) };
            },
          }),
          read_file: tool({
            description: "Read the contents of a file in the project.",
            inputSchema: z.object({ path: z.string() }),
            execute: async ({ path }) => {
              const { data, error } = await supabase
                .from("files")
                .select("content")
                .eq("project_id", projectId)
                .eq("path", path)
                .maybeSingle();
              if (error) return { error: error.message };
              if (!data) return { error: "not found" };
              return { content: data.content };
            },
          }),
          write_file: tool({
            description:
              "Create or overwrite a file in the project with the given full contents. Use this to add new files or update existing ones.",
            inputSchema: z.object({
              path: z.string().describe("File path like index.html, app.js, style.css"),
              content: z.string().describe("Full file contents"),
            }),
            execute: async ({ path, content }) => {
              const { error } = await supabase
                .from("files")
                .upsert(
                  { project_id: projectId, user_id: userId, path, content },
                  { onConflict: "project_id,path" },
                );
              if (error) return { ok: false, error: error.message };
              return { ok: true, path };
            },
          }),
          delete_file: tool({
            description: "Delete a file from the project.",
            inputSchema: z.object({ path: z.string() }),
            execute: async ({ path }) => {
              const { error } = await supabase
                .from("files")
                .delete()
                .eq("project_id", projectId)
                .eq("path", path);
              if (error) return { ok: false, error: error.message };
              return { ok: true };
            },
          }),
        };

        const system = `You are Forge, an AI coding assistant working on the user's project "${proj.name}".

You have tools to list, read, write, and delete files in this project. Projects are static web apps: HTML + CSS + JS (vanilla or via CDN like React UMD, Tailwind Play CDN, etc.). The user's preview iframe inlines <link href="...css"> and <script src="...js"> references to other files in the project.

Guidelines:
- Always start a build task by calling list_files to see what exists.
- When asked to make changes, use write_file with the COMPLETE new content (no diffs).
- Keep code self-contained — no npm imports. Use CDNs for libraries.
- The entry file is index.html. Reference other files with relative paths like "style.css" or "app.js".
- After making changes, give a brief summary of what you did. Do not paste the full code back to the user.`;

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(body.messages),
          tools,
          stopWhen: stepCountIs(20),
        });

        return result.toUIMessageStreamResponse({ originalMessages: body.messages });
      },
    },
  },
});