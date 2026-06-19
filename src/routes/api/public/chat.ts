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
        console.log("[chat] POST", { hasToken: !!token, projectId });
        if (!token) return new Response("Unauthorized: missing token", { status: 401 });
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
        if (userErr || !userRes.user) {
          console.log("[chat] getUser failed", userErr?.message);
          return new Response(`Unauthorized: ${userErr?.message ?? "no user"}`, { status: 401 });
        }
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

        const lastUserText = [...body.messages]
          .reverse()
          .find((message) => message.role === "user")
          ?.parts
          ?.map((part) => (part.type === "text" ? part.text : ""))
          .join(" ") ?? "";
        const needsFileChange = /\b(build|add|create|make|fix|update|change|implement|design|remove|delete|edit|style|wire|connect)\b/i.test(lastUserText);

        function normalizePath(path: string) {
          return path.trim().replace(/^\.{0,2}\/+/, "").replace(/\/+/g, "/");
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
              const cleanPath = normalizePath(path);
              const { data, error } = await supabase
                .from("files")
                .select("content")
                .eq("project_id", projectId)
                .eq("path", cleanPath)
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
              const cleanPath = normalizePath(path);
              if (!cleanPath || cleanPath.includes("..")) return { ok: false, error: "Invalid file path" };
              const { error } = await supabase
                .from("files")
                .upsert(
                  { project_id: projectId, user_id: userId, path: cleanPath, content },
                  { onConflict: "project_id,path" },
                );
              if (error) return { ok: false, error: error.message };
              const { data: saved, error: verifyError } = await supabase
                .from("files")
                .select("content")
                .eq("project_id", projectId)
                .eq("path", cleanPath)
                .maybeSingle();
              if (verifyError) return { ok: false, error: verifyError.message };
              if (!saved || saved.content !== content) return { ok: false, error: "File write did not persist" };
              return { ok: true, path: cleanPath };
            },
          }),
          delete_file: tool({
            description: "Delete a file from the project.",
            inputSchema: z.object({ path: z.string() }),
            execute: async ({ path }) => {
              const cleanPath = normalizePath(path);
              const { error } = await supabase
                .from("files")
                .delete()
                .eq("project_id", projectId)
                .eq("path", cleanPath);
              if (error) return { ok: false, error: error.message };
              return { ok: true };
            },
          }),
        };

        const system = `You are Forge, an autonomous AI coding agent working on the user's project "${proj.name}". You behave like Lovable: when the user asks for a feature, you BUILD IT — you do not explain what you would do, you do not ask permission, you do not stall. Implement, then briefly report.

The user may attach images or video frames (screenshots, photos, mockups, design references, screen recordings). Treat them as visual specs.

## Project shape
Static web app: HTML + CSS + JS (vanilla, or libs via CDN like React UMD, Tailwind Play CDN, Supabase JS CDN, etc.). Entry file is index.html. Reference other project files with relative paths ("style.css", "app.js"). No npm, no build step.

## Tools available
- list_files — see what exists
- read_file — read a file's contents
- write_file — create or overwrite a file with its FULL new contents (never diffs, never placeholders, never "...")
- delete_file — remove a file

## How you MUST work on every build request
1. Call list_files first to see the current state.
2. read_file on any file you'll modify so you preserve existing work.
3. write_file for every file you create or change — with the COMPLETE, runnable file contents. Do NOT output code in chat instead of writing it. Do NOT say "I'll add..." without calling the tool in the same turn.
4. Make sure index.html links every css/js file you created.
5. After the changes land, reply with a 1–3 sentence summary of what you built. Do not paste the code back.

## Behavior rules
- Default to action. If the request is reasonable (e.g. "build a signup area", "add a contact form", "make it dark mode"), just build it with sensible defaults — do not ask clarifying questions first.
- Ship complete, working features in one turn. A "signup area" means a real form with email + password fields, validation, a submit handler, and visible success/error states — not a placeholder.
- Match the existing visual style of the project when extending it.
- Never leave TODOs, "// your code here", or empty handlers. Wire everything up.
- If something genuinely blocks you (missing API key, ambiguous business logic), say so plainly in one line and still ship the best default implementation.`;

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(body.messages),
          tools,
          prepareStep: ({ steps, stepNumber }) => {
            if (!needsFileChange) return undefined;
            const toolResults = steps.flatMap((step) => step.toolResults);
            const hasListed = toolResults.some((result) => result.toolName === "list_files");
            const hasRead = toolResults.some((result) => result.toolName === "read_file");
            const hasMutation = toolResults.some((result) => result.toolName === "write_file" || result.toolName === "delete_file");

            if (stepNumber === 0 || !hasListed) {
              return { toolChoice: { type: "tool", toolName: "list_files" }, activeTools: ["list_files"] };
            }
            if (!hasRead && !hasMutation && stepNumber < 4) {
              return { toolChoice: "required", activeTools: ["read_file", "write_file"] };
            }
            if (!hasMutation && stepNumber < 8) {
              return { toolChoice: "required", activeTools: ["write_file", "delete_file"] };
            }
            return undefined;
          },
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({ originalMessages: body.messages });
      },
    },
  },
});