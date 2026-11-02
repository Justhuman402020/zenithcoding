// Reads an OpenAI-style streamed chat reply (SSE "data:" lines) and returns the full text.
// Streaming keeps bytes flowing so tunnels never cut a long answer off.
export async function readChatStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; complete: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let complete = false;
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
  return { text, complete };
}
