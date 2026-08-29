// File tools handed to the AI during a chat edit, plus the Groq provider.
// The file store is injected so the exact same tool flow can be exercised by
// the regression test with an in-memory store and a fake Groq server.

import { tool } from "ai";
import { z } from "zod";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { TraceLogger } from "./trace.server";

export type WriteResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; path: string; error: string };

export type ProjectFileStore = {
  list: () => Promise<string[]>;
  read: (path: string) => Promise<{ content?: string; error?: string }>;
  write: (path: string, content: string) => Promise<WriteResult>;
  remove: (path: string) => Promise<{ ok: boolean; error?: string }>;
};

export function normalizePath(path: string) {
  return path.trim().replace(/^\.{0,2}\/+/, "").replace(/\/+/g, "/");
}

export function createGroqProvider(apiKey: string, baseURL = "https://api.groq.com/openai/v1") {
  return createOpenAICompatible({
    name: "groq",
    baseURL,
    headers: { Authorization: `Bearer ${apiKey}` },
    transformRequestBody: (body) => ({
      ...body,
      messages: Array.isArray(body.messages)
        ? body.messages.map((message: unknown) => {
            if (!message || typeof message !== "object") return message;
            const { reasoning_content: _unsupportedReasoning, ...supportedMessage } = message as Record<string, unknown>;
            return supportedMessage;
          })
        : body.messages,
    }),
  });
}

type SupabaseLike = {
  from: (table: string) => any;
};

/** Store backed by the project's `files` table. */
export function createSupabaseFileStore(
  supabase: SupabaseLike,
  projectId: string,
  userId: string,
): ProjectFileStore {
  return {
    async list() {
      const { data } = await supabase.from("files").select("path").eq("project_id", projectId).order("path");
      return (data ?? []).map((f: { path: string }) => f.path);
    },
    async read(path) {
      const { data, error } = await supabase
        .from("files")
        .select("content")
        .eq("project_id", projectId)
        .eq("path", path)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: "not found" };
      return { content: data.content };
    },
    async write(path, content) {
      const { error } = await supabase
        .from("files")
        .upsert({ project_id: projectId, user_id: userId, path, content }, { onConflict: "project_id,path" });
      if (error) return { ok: false, path, error: error.message };
      const { data: saved, error: verifyError } = await supabase
        .from("files")
        .select("content")
        .eq("project_id", projectId)
        .eq("path", path)
        .maybeSingle();
      if (verifyError) return { ok: false, path, error: verifyError.message };
      if (!saved || saved.content !== content) return { ok: false, path, error: "File write did not persist" };
      return { ok: true, path, bytes: content.length };
    },
    async remove(path) {
      const { error } = await supabase.from("files").delete().eq("project_id", projectId).eq("path", path);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },
  };
}

/** In-memory store used by the regression test. */
export function createMemoryFileStore(initial: Record<string, string> = {}): ProjectFileStore & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async list() {
      return [...files.keys()].sort();
    },
    async read(path) {
      const content = files.get(path);
      return content === undefined ? { error: "not found" } : { content };
    },
    async write(path, content) {
      files.set(path, content);
      return { ok: true, path, bytes: content.length };
    },
    async remove(path) {
      files.delete(path);
      return { ok: true };
    },
  };
}

export function createProjectFileTools(store: ProjectFileStore, trace?: TraceLogger) {
  const log = (phase: string, options?: Parameters<TraceLogger["log"]>[1]) => trace?.log(phase, options);

  return {
    list_files: tool({
      description: "List all files in the current project.",
      inputSchema: z.object({}),
      execute: async () => {
        const started = Date.now();
        const files = await store.list();
        log("tool.list_files", { durationMs: Date.now() - started, detail: { count: files.length } });
        return { files };
      },
    }),
    read_file: tool({
      description: "Read the contents of a file in the project.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const started = Date.now();
        const cleanPath = normalizePath(path);
        const result = await store.read(cleanPath);
        log("tool.read_file", {
          status: result.error ? "warn" : "ok",
          durationMs: Date.now() - started,
          message: result.error,
          detail: { path: cleanPath, bytes: result.content?.length ?? 0 },
        });
        return result;
      },
    }),
    write_file: tool({
      description:
        "Create or overwrite a file in the project with the given full contents. This is the ONLY way to make user-visible changes.",
      inputSchema: z.object({
        path: z.string().describe("File path like index.html, app.js, style.css"),
        content: z.string().describe("Full file contents"),
      }),
      execute: async ({ path, content }): Promise<WriteResult> => {
        const started = Date.now();
        const cleanPath = normalizePath(path);
        if (!cleanPath || cleanPath.includes("..")) {
          const failure = { ok: false as const, path: cleanPath || path, error: "Invalid file path" };
          log("tool.write_file", { status: "error", message: failure.error, detail: { path } });
          return failure;
        }
        if (!content.trim()) {
          const failure = { ok: false as const, path: cleanPath, error: "Refusing to write an empty file" };
          log("tool.write_file", { status: "error", message: failure.error, detail: { path: cleanPath } });
          return failure;
        }
        const result = await store.write(cleanPath, content);
        log("tool.write_file", {
          status: result.ok ? "ok" : "error",
          durationMs: Date.now() - started,
          message: result.ok ? undefined : result.error,
          detail: { path: cleanPath, bytes: content.length },
        });
        return result;
      },
    }),
    delete_file: tool({
      description: "Delete a file from the project.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const cleanPath = normalizePath(path);
        const result = await store.remove(cleanPath);
        log("tool.delete_file", {
          status: result.ok ? "ok" : "error",
          message: result.error,
          detail: { path: cleanPath },
        });
        return result;
      },
    }),
  };
}
