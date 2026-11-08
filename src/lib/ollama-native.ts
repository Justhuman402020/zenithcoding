// Talks to Ollama's native /api/chat while the AI SDK keeps speaking OpenAI.
//
// Why: Ollama's OpenAI endpoint (/v1/chat/completions) cannot set the context
// size, so models load with Ollama's 4,096-token default and a ~10k-token
// build prompt is rejected. The native endpoint accepts options.num_ctx.
//
// Also: home PCs without a GPU read slowly (~20 tokens/second) and Ollama sends
// nothing until the first word, so a tunnel (Cloudflare cuts at ~100s) drops
// long first reads. We "warm up" the prompt in small slices first; Ollama keeps
// what it has read in its cache, so the real request then starts quickly.

export type OllamaNativeOptions = {
  /** Ollama server root, without /v1. */
  base: string;
  numCtx?: number;
  /** Max characters of new prompt per warm-up slice (≈ under a minute on CPU). */
  sliceChars?: number;
  /** Called while waiting so the caller's watchdog knows work is alive. */
  onProgress?: (info: { phase: "warmup" | "waiting" | "streaming"; stage?: number; stages?: number }) => void;
  fetchImpl?: typeof fetch;
  heartbeatMs?: number;
};

export const OLLAMA_DEFAULT_CTX = 24_576;
const FALLBACK_CTX = 12_288;
const IMAGE_CHARS = 4_000;
const RETRY_STATUSES = new Set([502, 504, 520, 522, 524]);

type OAIPart = { type: string; text?: string; image_url?: { url: string } | string };
type OAIMessage = { role: string; content?: string | OAIPart[] | null; tool_calls?: Array<{ id?: string; function: { name: string; arguments: string } }>; tool_call_id?: string };
export type OllamaMessage = { role: string; content: string; images?: string[]; tool_calls?: Array<{ function: { name: string; arguments: unknown } }>; tool_name?: string; thinking?: string };
type OllamaTool = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };

/** Remembered per server+model: lowered context after a memory error, warmed slices. */
const ctxMemo = new Map<string, number>();
const warmed = new Map<string, Set<string>>();

function parseArgs(raw: string) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

async function imageToBase64(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url);
  if (m) return m[1];
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch { return null; }
}

/** OpenAI chat messages → Ollama native messages. */
export async function toOllamaMessages(messages: OAIMessage[], fetchImpl: typeof fetch = fetch): Promise<OllamaMessage[]> {
  const names = new Map<string, string>();
  const out: OllamaMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const calls = (m.tool_calls ?? []).map((c) => {
        if (c.id) names.set(c.id, c.function.name);
        return { function: { name: c.function.name, arguments: parseArgs(c.function.arguments) } };
      });
      out.push({ role: "assistant", content: typeof m.content === "string" ? m.content : "", ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    if (m.role === "tool") {
      out.push({ role: "tool", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""), ...(m.tool_call_id && names.has(m.tool_call_id) ? { tool_name: names.get(m.tool_call_id) } : {}) });
      continue;
    }
    if (Array.isArray(m.content)) {
      const texts: string[] = [];
      const images: string[] = [];
      for (const p of m.content) {
        if (p.type === "text" && p.text) texts.push(p.text);
        if (p.type === "image_url" && p.image_url) {
          const b64 = await imageToBase64(typeof p.image_url === "string" ? p.image_url : p.image_url.url, fetchImpl);
          if (b64) images.push(b64);
        }
      }
      out.push({ role: m.role, content: texts.join("\n"), ...(images.length ? { images } : {}) });
      continue;
    }
    out.push({ role: m.role, content: m.content ?? "" });
  }
  return out;
}

type Stage = { messages: OllamaMessage[]; tools?: OllamaTool[] };

/**
 * Prompt prefixes that each add at most ~sliceChars of new text, in the order
 * Ollama renders them (system text, then tools, then each message). The full
 * request itself is not a stage. Small prompts need no warm-up.
 */
export function warmupStages(messages: OllamaMessage[], tools: OllamaTool[] = [], sliceChars = 4_000): Stage[] {
  const step = Math.max(200, Math.floor(sliceChars / 4));
  const checkpoints: Array<{ pos: number; build: () => Stage }> = [];
  let pos = 0;
  let toolsIn = 0;
  const firstIsSystem = messages[0]?.role === "system";
  const sysLen = firstIsSystem ? messages[0].content.length : 0;
  const withTools = (n: number) => (n ? tools.slice(0, n) : undefined);

  if (firstIsSystem) {
    const sys = messages[0];
    for (let cut = step; cut < sysLen; cut += step) {
      const c = cut;
      checkpoints.push({ pos: c, build: () => ({ messages: [{ ...sys, content: sys.content.slice(0, c) }] }) });
    }
    pos = sysLen;
    checkpoints.push({ pos, build: () => ({ messages: [sys] }) });
  }
  for (let t = 0; t < tools.length; t++) {
    pos += JSON.stringify(tools[t]).length;
    const n = t + 1;
    checkpoints.push({ pos, build: () => ({ messages: firstIsSystem ? [messages[0]] : [], tools: withTools(n) }) });
  }
  toolsIn = tools.length;
  for (let i = firstIsSystem ? 1 : 0; i < messages.length; i++) {
    const m = messages[i];
    const head = messages.slice(0, i);
    const start = pos;
    if (!m.tool_calls && !m.images && m.content.length > step) {
      for (let cut = step; cut < m.content.length; cut += step) {
        const c = cut;
        checkpoints.push({ pos: start + c, build: () => ({ messages: [...head, { ...m, content: m.content.slice(0, c) }], tools: withTools(toolsIn) }) });
      }
    }
    pos = start + m.content.length + (m.images?.length ?? 0) * IMAGE_CHARS + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
    const upto = i + 1;
    checkpoints.push({ pos, build: () => ({ messages: messages.slice(0, upto), tools: withTools(toolsIn) }) });
  }
  const total = pos;
  if (total < sliceChars * 1.5) return [];
  const stages: Stage[] = [];
  let last = 0;
  let prev: { pos: number; build: () => Stage } | null = null;
  for (const cp of checkpoints) {
    if (cp.pos >= total) break;
    if (cp.pos - last > sliceChars && prev && prev.pos > last) {
      stages.push(prev.build());
      last = prev.pos;
    }
    if (cp.pos - last >= sliceChars) {
      stages.push(cp.build());
      last = cp.pos;
    }
    prev = cp;
  }
  return stages;
}

function sse(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "ollama_error", code: status } }), { status, headers: { "Content-Type": "application/json" } });
}

function ollamaErrorMessage(text: string, status: number) {
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = typeof j?.error === "string" ? j.error : j?.error?.message ?? text;
    try { const inner = JSON.parse(msg); msg = inner?.error?.message ?? msg; } catch { /* plain */ }
  } catch { /* plain text */ }
  if (status === 524 || /error code: 524/.test(text)) return "Your PC's Ollama took longer than 100 seconds to start answering, so the tunnel closed the connection (524).";
  return String(msg).slice(0, 500) || `Ollama answered ${status}`;
}

/** A fetch that turns OpenAI chat calls into native Ollama calls (with num_ctx). */
export function createOllamaNativeFetch(opts: OllamaNativeOptions): typeof fetch {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.base.replace(/\/+$/, "").replace(/\/v1$/i, "");
  const slice = opts.sliceChars ?? 4_000;
  const beat = opts.heartbeatMs ?? 15_000;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/chat\/completions(\?|$)/.test(url) || !init?.body) return fetchImpl(input as any, init);
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    const model = String(body.model);
    const memoKey = `${base}|${model}`;
    let numCtx = ctxMemo.get(memoKey) ?? opts.numCtx ?? OLLAMA_DEFAULT_CTX;
    const messages = await toOllamaMessages(body.messages ?? [], fetchImpl);
    const tools: OllamaTool[] = Array.isArray(body.tools) ? body.tools.filter((t: any) => t?.type === "function") : [];
    const stream = body.stream === true;
    const signal = init.signal ?? undefined;
    const auth = new Headers(init.headers as HeadersInit | undefined).get("authorization");
    const sampling: Record<string, unknown> = {};
    if (typeof body.temperature === "number") sampling.temperature = body.temperature;
    if (typeof body.top_p === "number") sampling.top_p = body.top_p;
    if (body.stop) sampling.stop = body.stop;
    if (typeof body.seed === "number") sampling.seed = body.seed;

    const post = (payload: Record<string, unknown>) => fetchImpl(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ model, keep_alive: "30m", ...payload, options: { ...(payload.options as object), num_ctx: numCtx } }),
      signal,
    });

    // Keep the caller's watchdog alive while Ollama reads (it sends nothing meanwhile).
    const heartbeat = (phase: "warmup" | "waiting") => {
      const id = setInterval(() => opts.onProgress?.({ phase }), beat);
      return () => clearInterval(id);
    };

    const lowerOnMemory = async (res: Response) => {
      if (res.ok || numCtx <= FALLBACK_CTX) return false;
      const text = await res.clone().text().catch(() => "");
      if (!/memory|out of memory|insufficient/i.test(text)) return false;
      numCtx = FALLBACK_CTX;
      ctxMemo.set(memoKey, numCtx);
      warmed.delete(memoKey);
      return true;
    };

    // 1) Warm the cache in slices so no single call waits >100s for a first word.
    const stages = warmupStages(messages, tools, slice);
    const done = warmed.get(memoKey) ?? new Set<string>();
    warmed.set(memoKey, done);
    for (let s = 0; s < stages.length; s++) {
      if (signal?.aborted) break;
      const sig = `${numCtx}|${JSON.stringify(stages[s])}`;
      const key = `${sig.length}:${hash(sig)}`;
      if (done.has(key)) continue;
      opts.onProgress?.({ phase: "warmup", stage: s + 1, stages: stages.length });
      const stop = heartbeat("warmup");
      try {
        for (let tryNo = 0; tryNo < 4; tryNo++) {
          let res: Response;
          try {
            res = await post({ messages: stages[s].messages, ...(stages[s].tools ? { tools: stages[s].tools } : {}), stream: false, options: { num_predict: 1, temperature: 0 } });
          } catch (e) {
            if (signal?.aborted) throw e;
            continue; // network blip; Ollama keeps what it already read
          }
          if (res.ok) { await res.text().catch(() => ""); done.add(key); break; }
          if (await lowerOnMemory(res)) { s = -1; break; }
          const text = await res.text().catch(() => "");
          if (RETRY_STATUSES.has(res.status)) continue; // partial progress is cached
          if (/exceeds the available context size|context length/i.test(text)) break; // real call reports it
          break;
        }
      } finally { stop(); }
      if (s === -1) { done.clear(); }
    }
    if (done.size > 2_000) done.clear();

    // 2) The real call.
    const real = { messages, ...(tools.length ? { tools } : {}), stream, options: { ...sampling, ...(typeof body.max_tokens === "number" ? { num_predict: body.max_tokens } : {}) } };
    let res: Response | null = null;
    let lastText = "";
    const stop = heartbeat("waiting");
    try {
      for (let tryNo = 0; tryNo < 3; tryNo++) {
        try { res = await post(real); } catch (e) { if (signal?.aborted) throw e; res = null; continue; }
        if (res.ok) break;
        if (await lowerOnMemory(res)) { tryNo--; continue; } // happens once: reload smaller
        lastText = await res.text().catch(() => "");
        if (!RETRY_STATUSES.has(res.status)) break;
      }
    } finally { stop(); }
    if (!res) return errorResponse(502, "Could not reach your Ollama tunnel. Check that Ollama and the tunnel are running on your PC.");
    if (!res.ok) {
      const msg = ollamaErrorMessage(lastText, res.status);
      const hint = /exceeds the available context size/i.test(msg) ? ` This work no longer fits your PC model's memory (${numCtx} tokens). Start a new, smaller request.` : "";
      return errorResponse(res.status, msg + hint);
    }

    const id = `chatcmpl-ollama-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    if (!stream) {
      const j = (await res.json()) as any;
      const calls = (j?.message?.tool_calls ?? []).map((c: any, i: number) => ({ id: `call_${created}_${i}`, type: "function", function: { name: c.function?.name, arguments: JSON.stringify(c.function?.arguments ?? {}) } }));
      return new Response(JSON.stringify({
        id, object: "chat.completion", created, model,
        choices: [{ index: 0, message: { role: "assistant", content: j?.message?.content ?? "", ...(j?.message?.thinking ? { reasoning_content: j.message.thinking } : {}), ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? "tool_calls" : j?.done_reason === "length" ? "length" : "stop" }],
        usage: { prompt_tokens: j?.prompt_eval_count ?? 0, completion_tokens: j?.eval_count ?? 0, total_tokens: (j?.prompt_eval_count ?? 0) + (j?.eval_count ?? 0) },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const upstream = res.body!;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let toolIndex = 0;
    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        let buf = "";
        let sentRole = false;
        const tick = setInterval(() => opts.onProgress?.({ phase: "streaming" }), beat);
        const emit = (delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) => {
          if (!sentRole) { delta = { role: "assistant", ...delta }; sentRole = true; }
          controller.enqueue(encoder.encode(sse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })));
        };
        const handle = (line: string) => {
          if (!line.trim()) return false;
          let j: any;
          try { j = JSON.parse(line); } catch { return false; }
          if (j.error) { controller.enqueue(encoder.encode(sse({ error: { message: ollamaErrorMessage(JSON.stringify(j), 500) } }))); return true; }
          const msg = j.message ?? {};
          if (msg.thinking) emit({ reasoning_content: msg.thinking });
          if (msg.content) emit({ content: msg.content });
          for (const c of msg.tool_calls ?? []) {
            const i = toolIndex++;
            emit({ tool_calls: [{ index: i, id: `call_${created}_${i}`, type: "function", function: { name: c.function?.name, arguments: JSON.stringify(c.function?.arguments ?? {}) } }] });
          }
          if (j.done) {
            const usage = { prompt_tokens: j.prompt_eval_count ?? 0, completion_tokens: j.eval_count ?? 0, total_tokens: (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0) };
            emit({}, toolIndex ? "tool_calls" : j.done_reason === "length" ? "length" : "stop", usage);
            return true;
          }
          return false;
        };
        try {
          let finished = false;
          while (!finished) {
            const { value, done: end } = await reader.read();
            if (end) break;
            opts.onProgress?.({ phase: "streaming" });
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (handle(line)) { finished = true; break; }
            }
          }
          if (!finished && buf) handle(buf);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          controller.error(e);
        } finally {
          clearInterval(tick);
        }
      },
    });
    return new Response(out, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** True for the provider ids used by Ollama builds (ollama-<key id>). */
export function isOllamaProviderId(id: string) {
  return /^ollama-/.test(id);
}
