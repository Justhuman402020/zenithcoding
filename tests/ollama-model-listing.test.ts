import { describe, it, expect, afterEach, vi } from "vitest";
import { listModelIds } from "../src/lib/custom-providers.server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("model listing with Ollama tunnels (no live provider calls)", () => {
  it("retries /v1/models when /models returns 404", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      if (String(input).endsWith("/models")) return jsonResponse(404, { error: "404 page not found" });
      return jsonResponse(200, { data: [{ id: "llama3.2:latest" }, { id: "qwen3:8b" }] });
    }) as typeof fetch;
    const r = await listModelIds("https://tunnel.example.com", "k");
    expect(calls).toEqual(["https://tunnel.example.com/models", "https://tunnel.example.com/v1/models"]);
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["llama3.2:latest", "qwen3:8b"]);
  });

  it("does not retry when /models succeeds (other providers keep existing behavior)", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return jsonResponse(200, { data: [{ id: "gpt-x" }] });
    }) as typeof fetch;
    const r = await listModelIds("https://api.example.com/v1", "k");
    expect(calls).toEqual(["https://api.example.com/v1/models"]);
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["gpt-x"]);
  });

  it("retries only on 404, not on other errors", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return jsonResponse(401, { error: "bad key" });
    }) as typeof fetch;
    const r = await listModelIds("https://tunnel.example.com", "k");
    expect(calls).toEqual(["https://tunnel.example.com/models"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("401");
  });

  it("reports failure when both /models and /v1/models 404", async () => {
    globalThis.fetch = (async () => jsonResponse(404, { error: "404 page not found" })) as typeof fetch;
    const r = await listModelIds("https://tunnel.example.com", "k");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("404");
  });
});
