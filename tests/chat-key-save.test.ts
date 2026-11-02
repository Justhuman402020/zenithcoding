import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validator: ((data: unknown) => unknown) | undefined;
    const builder = {
      middleware: () => builder,
      inputValidator: (fn: typeof validator) => { validator = fn; return builder; },
      handler: (fn: (args: unknown) => unknown) => (args: { data?: unknown; context: unknown }) =>
        fn({ ...args, data: validator ? validator(args.data) : args.data }),
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("../src/lib/secrets-crypto.server", () => ({ encryptSecret: vi.fn(async () => "encrypted-test-payload"), decryptSecret: vi.fn(async () => "noncredential-test-input") }));

import { addOllamaKey, listOllamaKeys, listOllamaModels } from "../src/lib/assistant.functions";

describe("Admin chat-key saving", () => {
  const insert = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => ({ data: true }));
  const order = vi.fn(async () => ({ data: [{ id: "saved-key", label: "Ollama", base_url: "https://bars-add-scanner-part.trycloudflare.com", active: false, active_model: null }] }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ insert, select }));
  const context = { userId: "owner-id", supabase: { rpc, from } };
  const data = { label: "Ollama", baseUrl: "https://bars-add-scanner-part.trycloudflare.com", apiKey: "noncredential-test-input" };
  // Supply the mocked middleware context without changing the production RPC contract.
  const save = addOllamaKey as unknown as (args: { data: typeof data; context: typeof context }) => Promise<{ ok: boolean }>;
  const list = listOllamaKeys as unknown as (args: { context: typeof context }) => Promise<Array<{ label: string; base_url: string }>>;

  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: true }); });

  it("saves the Ollama tunnel key encrypted under the signed-in owner, not Brain keys", async () => {
    expect(await save({ data, context })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("has_role", { _user_id: "owner-id", _role: "admin" });
    expect(from).toHaveBeenCalledExactlyOnceWith("ollama_keys");
    expect(insert).toHaveBeenCalledWith({ user_id: "owner-id", label: "Ollama", base_url: data.baseUrl, key_encrypted: "encrypted-test-payload" });
  });

  it("lists saved chat keys without selecting credential values", async () => {
    const keys = await list({ context });
    expect(keys[0]).toMatchObject({ label: "Ollama", base_url: data.baseUrl });
    expect(select).toHaveBeenCalledWith("id,label,base_url,created_at,active,active_model");
  });

  it("refuses saving for non-admins before any insert", async () => {
    rpc.mockResolvedValue({ data: false });
    await expect(save({ data, context })).rejects.toThrow("Only an admin can change chat keys");
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports an offline Ollama tunnel without exposing its HTML or changing saved keys", async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: { base_url: data.baseUrl, key_encrypted: "encrypted-test-payload" } })) };
    const keyContext = { userId: "owner-id", supabase: { from: vi.fn(() => query) } };
    const fetchMock = vi.fn(async () => new Response("<!doctype html><h1>Cloudflare Tunnel error 1033</h1>", { status: 530 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const models = listOllamaModels as unknown as (args: { data: { keyId: string }; context: typeof keyContext }) => Promise<{ models: string[]; error: string | null }>;
      const result = await models({ data: { keyId: "feb59d85-9476-4bef-b7dc-727d69537aca" }, context: keyContext });
      expect(result.models).toEqual([]);
      expect(result.error).toContain("Your Ollama tunnel is offline or has expired.");
      expect(result.error).not.toContain("<!doctype");
      expect(keyContext.supabase.from).toHaveBeenCalledExactlyOnceWith("ollama_keys");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(insert).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses direct server-function declarations so chat-key middleware survives compilation", () => {
    const source = ts.createSourceFile("assistant.functions.ts", readFileSync(new URL("../src/lib/assistant.functions.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const factories = new Map<string, string>();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        let root = declaration.initializer;
        while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) root = root.expression.expression;
        if (ts.isCallExpression(root) && ts.isIdentifier(root.expression)) factories.set(declaration.name.text, root.expression.text);
      }
    }
    for (const name of ["addOllamaKey", "listOllamaKeys", "setKeyActive", "listOllamaModels"]) {
      expect(factories.get(name)).toBe("createServerFn");
    }
  });
});