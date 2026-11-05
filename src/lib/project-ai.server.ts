// Runs a project site's AI chat through the owner's Cloudflare pool (key #1 → #2 …).
import { estimateNeurons, isCloudflareBaseUrl, loadCloudflarePool, addNeurons, markExhausted, readCloudflareCodingModel } from "./cloudflare-pool.server";
import { pickSiteChatModel } from "./project-ai-policy";

type Msg = { role: string; content: string };

export async function hashSiteToken(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSiteToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "chai_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Returns the first key's streaming/JSON response; waterfalls on 429/5xx. */
export async function runSiteChat(opts: { projectId: string; userId: string; messages: Msg[]; stream: boolean; model?: string | null }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { recordNeuronCall } = await import("./workspace-ai.server");
  const model = pickSiteChatModel(opts.model, await readCloudflareCodingModel());
  const pool = (await loadCloudflarePool()).filter((k) => k.status !== "exhausted");
  if (!pool.length) return { ok: false as const, status: 503, error: "All Cloudflare keys are used up for today." };
  const { data: rows } = await supabaseAdmin.from("custom_ai_providers").select("id, base_url, key_encrypted").in("id", pool.map((k) => k.id));
  const byId = new Map((rows ?? []).map((r: any) => [r.id, r]));
  const inputTokens = Math.ceil(opts.messages.reduce((t, m) => t + m.content.length, 0) / 4);
  let lastErr = "Cloudflare did not answer.";
  for (const key of pool) {
    const row: any = byId.get(key.id);
    if (!row || !isCloudflareBaseUrl(row.base_url)) continue;
    const token = (await decryptSecret(row.key_encrypted)).replace(/^Bearer\s+/i, "").trim();
    const res = await fetch(`${row.base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: opts.messages, stream: opts.stream, max_tokens: 2000 }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
    if (!res.ok) {
      lastErr = `Cloudflare ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status === 429) await markExhausted(key.id);
      if (res.status === 429 || res.status >= 500 || res.status === 0) continue;
      return { ok: false as const, status: 502, error: lastErr };
    }
    const record = (outChars: number) => {
      const neurons = estimateNeurons(inputTokens, Math.ceil(outChars / 4));
      void addNeurons(key.id, neurons);
      void recordNeuronCall({ user_id: opts.userId, project_id: opts.projectId, section: "chat", provider_id: key.id, key_number: key.position, model, input_tokens: inputTokens, output_tokens: Math.ceil(outChars / 4), neurons, source: "site", action: "site_chat", status: "ok" }).catch(() => undefined);
    };
    if (!opts.stream) {
      const j: any = await res.json();
      const reply = String(j?.choices?.[0]?.message?.content ?? "");
      record(reply.length);
      return { ok: true as const, reply };
    }
    let chars = 0;
    const dec = new TextDecoder();
    const body = (res.body as ReadableStream<Uint8Array>).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          for (const m of dec.decode(chunk, { stream: true }).matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)) chars += m[1].length;
          ctl.enqueue(chunk);
        },
        flush() { record(chars); },
      }),
    );
    return { ok: true as const, body };
  }
  return { ok: false as const, status: 503, error: lastErr };
}
