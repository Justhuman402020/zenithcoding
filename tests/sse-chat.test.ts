import { describe, it, expect } from "vitest";
import { readChatStream } from "../src/lib/sse-chat";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
}

describe("readChatStream", () => {
  it("joins split SSE frames into the full answer", async () => {
    const r = await readChatStream(streamOf([
      'data: {"choices":[{"delta":{"content":"Bar"}}]}\n\ndata: {"choi',
      'ces":[{"delta":{"content":"ber plan"}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    expect(r).toEqual({ text: "Barber plan", complete: true, toolCalls: [] });
  });

  it("keeps partial text when the stream ends without finishing", async () => {
    const r = await readChatStream(streamOf(['data: {"choices":[{"delta":{"content":"Part"}}]}\n\n']));
    expect(r).toEqual({ text: "Part", complete: false, toolCalls: [] });
  });
});

describe("readChatStream tool calls", () => {
  it("joins a tool call that arrives in pieces", async () => {
    const r = await readChatStream(streamOf([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"index.html\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
    ]));
    expect(r.toolCalls).toEqual([{ id: "c1", name: "read_file", arguments: '{"path":"index.html"}' }]);
    expect(r.complete).toBe(true);
  });
});
