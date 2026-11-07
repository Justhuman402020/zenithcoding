// Reads an OpenAI-style streamed chat reply (SSE "data:" lines) and returns the full text
// plus any tool calls the model asked for. Streaming keeps bytes flowing so tunnels never cut a long answer off.
export type StreamToolCall = { id: string; name: string; arguments: string };

export async function readChatStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; complete: boolean; toolCalls: StreamToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let complete = false;
  const calls: StreamToolCall[] = [];
  const handle = (line: string) => {
    const l = line.trim();
    if (!l.startsWith("data:")) return;
    const payload = l.slice(5).trim();
    if (payload === "[DONE]") { complete = true; return; }
    try {
      const json = JSON.parse(payload);
      const choice = json?.choices?.[0];
      const piece = choice?.delta?.content ?? choice?.message?.content;
      if (typeof piece === "string") text += piece;
      const tcs = choice?.delta?.tool_calls ?? choice?.message?.tool_calls;
      if (Array.isArray(tcs)) {
        tcs.forEach((tc: any, i: number) => {
          const idx = typeof tc?.index === "number" ? tc.index : i;
          const cur = calls[idx] ?? (calls[idx] = { id: "", name: "", arguments: "" });
          if (tc?.id) cur.id = String(tc.id);
          if (tc?.function?.name) cur.name += String(tc.function.name);
          const a = tc?.function?.arguments;
          if (typeof a === "string") cur.arguments += a;
          else if (a && typeof a === "object") cur.arguments = JSON.stringify(a);
        });
      }
      if (choice?.finish_reason) complete = true;
    } catch { /* ignore partial or non-JSON lines */ }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    buffer += decoder.decode();
    if (buffer) handle(buffer);
  } catch {
    // Connection dropped mid-answer: keep what arrived.
  }
  const toolCalls = calls.filter(Boolean).filter((c) => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return { text, complete, toolCalls };
}
