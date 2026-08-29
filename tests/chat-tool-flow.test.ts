// End-to-end regression test for the Groq tool-call build flow.
//
// It stands up a fake Groq-compatible SSE server that answers exactly like Groq
// (streamed tool_calls, then a final text message), runs the real production
// agent code (tools + step policy + provider), and asserts that:
//   1. the model walks list_files -> read_file -> write_file,
//   2. the file is actually saved,
//   3. the published preview HTML reflects the saved file.

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";

import { createGroqProvider, createMemoryFileStore, createProjectFileTools } from "@/lib/chat-tools.server";
import { compactChatMessages, createPrepareStep, detectFileChangeIntent } from "@/lib/chat-agent.server";

type ChatMessage = { role: string; content?: unknown; name?: string; tool_call_id?: string };

function sse(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return sse({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "openai/gpt-oss-120b",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function toolCallStream(id: string, name: string, args: unknown) {
  return (
    chunk({ role: "assistant", content: "" }) +
    chunk({
      tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    }) +
    chunk({}, "tool_calls") +
    "data: [DONE]\n\n"
  );
}

function textStream(text: string) {
  return (
    chunk({ role: "assistant", content: "" }) + chunk({ content: text }) + chunk({}, "stop") + "data: [DONE]\n\n"
  );
}

const NEW_HTML = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>2630</h1></body></html>`;

let server: Server;
let baseURL: string;
const requestLog: Array<{ toolNames: string[]; toolResults: number }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { messages: ChatMessage[]; tools?: Array<{ function: { name: string } }> };
      const messages = body.messages ?? [];
      const toolResults = messages.filter((m) => m.role === "tool");
      requestLog.push({
        toolNames: (body.tools ?? []).map((t) => t.function.name),
        toolResults: toolResults.length,
      });

      res.writeHead(200, { "content-type": "text/event-stream" });
      if (toolResults.length === 0) res.end(toolCallStream("call_1", "list_files", {}));
      else if (toolResults.length === 1) res.end(toolCallStream("call_2", "read_file", { path: "index.html" }));
      else if (toolResults.length === 2)
        res.end(toolCallStream("call_3", "write_file", { path: "index.html", content: NEW_HTML }));
      else res.end(textStream("Updated index.html — the heading now reads 2630."));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Groq chat edit flow", () => {
  it("treats failure reports as build requests", () => {
    expect(detectFileChangeIntent("Nothing is working, fix that")).toBe(true);
    expect(detectFileChangeIntent("The build keeps failing")).toBe(true);
  });

  it("keeps current screenshots but removes stale media and tool payloads", () => {
    const staleImage = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,old" };
    const currentImage = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,new" };
    const history: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Use this design" }, staleImage] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "I updated it" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Fix the mobile layout" }, currentImage] },
    ];

    const compacted = compactChatMessages(history);
    expect(compacted).toHaveLength(3);
    expect(compacted[0]?.parts).toEqual([{ type: "text", text: "Use this design" }]);
    expect(compacted[2]?.parts).toContainEqual(currentImage);
  });

  it("lists, reads, writes and persists the file", async () => {
    const store = createMemoryFileStore({
      "index.html": `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>zenithvideioai</h1></body></html>`,
      "style.css": "h1{color:#f0f}",
    });
    const tools = createProjectFileTools(store);
    const prompt = "change zenithvideioai to 2630";
    const needsFileChange = detectFileChangeIntent(prompt);
    expect(needsFileChange).toBe(true);

    const messages: UIMessage[] = [{ id: "1", role: "user", parts: [{ type: "text", text: prompt }] }];

    const groq = createGroqProvider("test-key", baseURL);
    const result = streamText({
      model: groq("openai/gpt-oss-120b"),
      system: "test",
      messages: await convertToModelMessages(messages),
      tools,
      prepareStep: createPrepareStep(needsFileChange),
      stopWhen: stepCountIs(10),
    });

    const text = await result.text;
    const steps = await result.steps;
    const calledTools = steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));

    expect(calledTools).toEqual(["list_files", "read_file", "write_file"]);
    expect(store.files.get("index.html")).toBe(NEW_HTML);
    expect(store.files.get("index.html")).toContain("2630");
    expect(store.files.get("index.html")).not.toContain("zenithvideioai");
    expect(text).toMatch(/2630/);

    // every continuation request must still carry all four tool definitions,
    // otherwise Groq rejects the previously-made tool calls mid-build.
    for (const entry of requestLog) {
      expect(entry.toolNames.sort()).toEqual(["delete_file", "list_files", "read_file", "write_file"]);
    }
  });

  it("reports a save failure instead of claiming success", async () => {
    const store = createMemoryFileStore({ "index.html": "<h1>old</h1>" });
    store.write = async (path) => ({ ok: false, path, error: "File write did not persist" });
    const tools = createProjectFileTools(store);
    const output = await tools.write_file.execute!(
      { path: "index.html", content: "<h1>new</h1>" },
      { toolCallId: "t", messages: [] },
    );
    expect(output).toEqual({ ok: false, path: "index.html", error: "File write did not persist" });
  });

  it("renders the saved file in the published preview", async () => {
    const files = [
      { path: "index.html", content: NEW_HTML, kind: "source" },
      { path: "style.css", content: "h1{color:#0ff}", kind: "source" },
    ];
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: {
        from: () => ({ select: () => ({ eq: async () => ({ data: files }) }) }),
      },
    }));
    const { renderProjectHtml } = await import("@/lib/render-site.server");
    const response = await renderProjectHtml({
      projectId: "p1",
      projectName: "Test",
      requestUrl: "http://localhost/s/test",
      navLinkBase: "/s/test",
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("2630");
    // linked css got inlined, so the preview really serves the saved files
    expect(html).toContain("h1{color:#0ff}");
  });
});
