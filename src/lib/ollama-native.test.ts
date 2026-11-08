import { describe, expect, it } from "vitest";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createOllamaNativeFetch, warmupStages, toOllamaMessages, OLLAMA_DEFAULT_CTX } from "./ollama-native";
import { createGroqProvider } from "./chat-tools.server";

type Call = { url: string; body: any };

function fakeOllama(reply: (body: any, n: number) => Response) {
  const calls: Call[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    return reply(body, calls.length);
  }) as typeof fetch;
  return { f, calls };
}

const ndjson = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200 });

describe("Ollama native connector", () => {
  it("asks Ollama for a 24,576-token reading limit instead of the 4,096 default", async () => {
    const { f, calls } = fakeOllama(() => ndjson([{ message: { content: "hi" }, done: true, prompt_eval_count: 5, eval_count: 1 }]));
    const fetcher = createOllamaNativeFetch({ base: "https://pc.example/v1", fetchImpl: f });
    await (await fetcher("https://pc.example/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "qwen", stream: true, messages: [{ role: "user", content: "hi" }] }) })).text();
    expect(OLLAMA_DEFAULT_CTX).toBe(24_576);
    expect(calls[0].url).toBe("https://pc.example/api/chat");
    expect(calls[0].body.options.num_ctx).toBe(24_576);
  });

  it("splits a long prompt into warm-up parts that each add at most the slice size", () => {
    const sys = { role: "system", content: "x".repeat(20_000) };
    const user = { role: "user", content: "y".repeat(9_000) };
    const stages = warmupStages([sys, user], [], 4_000);
    expect(stages.length).toBeGreaterThanOrEqual(6);
    const size = (s: { messages: { content: string }[] }) => s.messages.reduce((n, m) => n + m.content.length, 0);
    let prev = 0;
    for (const s of stages) {
      expect(size(s) - prev).toBeLessThanOrEqual(4_000);
      prev = size(s);
    }
    expect(size(stages[stages.length - 1])).toBeLessThan(29_000);
  });

  it("skips warm-up for short prompts", () => {
    expect(warmupStages([{ role: "user", content: "hello" }], [], 4_000)).toEqual([]);
  });

  it("sends pictures to Ollama as base64 images", async () => {
    const out = await toOllamaMessages([{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] }]);
    expect(out[0]).toEqual({ role: "user", content: "what is this", images: ["QUJD"] });
  });

  it("lets the build agent call a tool through Ollama and read the answer", async () => {
    const { f, calls } = fakeOllama((body) => {
      if (body.options?.num_predict === 1) return new Response(JSON.stringify({ message: { content: "." }, done: true }), { status: 200 });
      const hasToolResult = body.messages.some((m: any) => m.role === "tool");
      return hasToolResult
        ? ndjson([{ message: { content: "Done: " }, done: false }, { message: { content: "file is ok" }, done: true, done_reason: "stop", prompt_eval_count: 9, eval_count: 3 }])
        : ndjson([{ message: { content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "index.html" } } }] }, done: false }, { message: { content: "" }, done: true, prompt_eval_count: 7, eval_count: 2 }]);
    });
    const model = createGroqProvider("ollama", "https://pc.example/v1", createOllamaNativeFetch({ base: "https://pc.example/v1", fetchImpl: f }))("qwen");
    const read: string[] = [];
    const result = streamText({
      model,
      prompt: "check index.html",
      tools: { read_file: tool({ description: "read", inputSchema: z.object({ path: z.string() }), execute: async ({ path }) => { read.push(path); return "<html></html>"; } }) },
      stopWhen: stepCountIs(3),
    });
    expect(await result.text).toBe("Done: file is ok");
    expect(read).toEqual(["index.html"]);
    const second = calls.filter((c) => c.body.options?.num_predict !== 1)[1].body;
    expect(second.messages.find((m: any) => m.role === "tool")).toMatchObject({ role: "tool", tool_name: "read_file" });
    expect(second.messages.find((m: any) => m.role === "assistant").tool_calls[0].function.arguments).toEqual({ path: "index.html" });
  });

  it("retries when the tunnel times out (524) and shows a clear message if it keeps failing", async () => {
    const { f, calls } = fakeOllama(() => new Response("error code: 524", { status: 524 }));
    const fetcher = createOllamaNativeFetch({ base: "https://pc.example", fetchImpl: f });
    const res = await fetcher("https://pc.example/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "qwen-retry", stream: true, messages: [{ role: "user", content: "hi" }] }) });
    expect(res.status).toBe(524);
    expect(calls.length).toBe(3);
    expect((await res.json()).error.message).toMatch(/100 seconds/);
  });
});
