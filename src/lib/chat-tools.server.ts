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

export type FileEdit = { find: string; replace: string; all?: boolean };

/** Applies find/replace edits. Exact match first, then a whitespace-tolerant match. */
export function applyEdits(source: string, edits: FileEdit[]): { ok: true; content: string } | { ok: false; error: string } {
  let out = source;
  for (let i = 0; i < edits.length; i++) {
    const { find, replace, all } = edits[i]!;
    const count = out.split(find).length - 1;
    if (count === 1 || (count > 1 && all)) {
      out = all ? out.split(find).join(replace) : out.replace(find, () => replace);
      continue;
    }
    if (count > 1) return { ok: false, error: `Edit ${i + 1}: find text matches ${count} places — add more surrounding lines or set all=true` };
    // Whitespace-tolerant fallback: collapse runs of spaces/tabs and line-end spaces.
    const esc = find.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(esc, all ? "g" : "");
    const matches = out.match(new RegExp(esc, "g"))?.length ?? 0;
    if (matches === 0) return { ok: false, error: `Edit ${i + 1}: find text not found — read_file again and copy the exact text` };
    if (matches > 1 && !all) return { ok: false, error: `Edit ${i + 1}: find text matches ${matches} places — add more surrounding lines` };
    out = out.replace(re, () => replace);
  }
  return { ok: true, content: out };
}

export function createProjectFileTools(store: ProjectFileStore, trace?: TraceLogger) {
  const log = (phase: string, options?: Parameters<TraceLogger["log"]>[1]) => trace?.log(phase, options);
  const repairCounts = new Map<string, number>();

  async function runEdits(path: string, edits: FileEdit[], phase: string): Promise<WriteResult & { edits?: number }> {
    const started = Date.now();
    const cleanPath = normalizePath(path);
    if (!cleanPath || cleanPath.includes("..")) return { ok: false, path, error: "Invalid file path" };
    const current = await store.read(cleanPath);
    if (current.error || current.content == null) {
      const failure = { ok: false as const, path: cleanPath, error: `Can't edit: ${current.error ?? "not found"}. Use write_file to create a new file.` };
      log(phase, { status: "error", message: failure.error, detail: { path: cleanPath } });
      return failure;
    }
    const applied = applyEdits(current.content, edits);
    if (!applied.ok) {
      log(phase, { status: "error", message: applied.error, detail: { path: cleanPath } });
      return { ok: false, path: cleanPath, error: applied.error };
    }
    if (applied.content === current.content) return { ok: false, path: cleanPath, error: "Edit changed nothing — the replace text equals the find text" };
    const { validateFile, repairDecision, MAX_REPAIRS } = await import("./cf-pool-policy");
    const check = validateFile(cleanPath, applied.content);
    if (!check.ok) {
      const n = (repairCounts.get(cleanPath) ?? 0) + 1;
      repairCounts.set(cleanPath, n);
      const pause = repairDecision(n) === "pause";
      const error = pause
        ? `Not saved: ${check.error}. ${MAX_REPAIRS} repair attempts used — stop editing this file, keep the saved version, then end your turn saying what is left.`
        : `Not saved: ${check.error} after this edit. Repair attempt ${n} of ${MAX_REPAIRS}: fix the edit and try again.`;
      log(phase, { status: "error", message: error, detail: { path: cleanPath, repair: n } });
      return { ok: false, path: cleanPath, error };
    }
    repairCounts.delete(cleanPath);
    const result = await store.write(cleanPath, applied.content);
    log(phase, { status: result.ok ? "ok" : "error", durationMs: Date.now() - started, message: result.ok ? undefined : result.error, detail: { path: cleanPath, edits: edits.length, bytes: applied.content.length } });
    return result.ok ? { ...result, edits: edits.length } : result;
  }

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
      description:
        "Read a file. Returns an explicit character range and continuation position for large files; continue reading until hasMore is false before rewriting it.",
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().int().min(0).optional().describe("Character offset to start from, default 0"),
        limit: z.number().int().min(1).max(200_000).optional().describe("Characters to return, default 60000"),
      }),
      execute: async ({ path, offset = 0, limit = 60_000 }) => {
        const started = Date.now();
        const cleanPath = normalizePath(path);
        const result = await store.read(cleanPath);
        const full = result.content ?? "";
        const content = result.error ? undefined : full.slice(offset, offset + limit);
        const nextOffset = offset + (content?.length ?? 0);
        const ranged = result.error
          ? result
          : {
              content,
              path: cleanPath,
              offset,
              end: nextOffset,
              totalBytes: full.length,
              hasMore: nextOffset < full.length,
              nextOffset: nextOffset < full.length ? nextOffset : null,
            };
        log("tool.read_file", {
          status: result.error ? "warn" : "ok",
          durationMs: Date.now() - started,
          message: result.error,
          detail: { path: cleanPath, bytes: content?.length ?? 0, offset, totalBytes: full.length },
        });
        return ranged;
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
        // Only complete, valid files are saved. Up to 3 repairs, then pause with a note.
        const { validateFile, repairDecision, MAX_REPAIRS } = await import("./cf-pool-policy");
        const check = validateFile(cleanPath, content);
        if (!check.ok) {
          const n = (repairCounts.get(cleanPath) ?? 0) + 1;
          repairCounts.set(cleanPath, n);
          const pause = repairDecision(n) === "pause";
          const failure = {
            ok: false as const,
            path: cleanPath,
            error: pause
              ? `Not saved: ${check.error}. ${MAX_REPAIRS} repair attempts used — stop editing this file, keep the saved version, call update_handoff with what is left, then end your turn.`
              : `Not saved: ${check.error}. Repair attempt ${n} of ${MAX_REPAIRS}: write the COMPLETE file again.`,
          };
          log("tool.write_file", { status: "error", message: failure.error, detail: { path: cleanPath, repair: n } });
          return failure;
        }
        repairCounts.delete(cleanPath);
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
    edit_file: tool({
      description:
        "Change part of an existing file: replace an exact snippet (find) with new text (replace). Cheapest way to make small changes — prefer this over write_file for edits. Include a few surrounding lines in find so it is unique.",
      inputSchema: z.object({
        path: z.string(),
        find: z.string().min(1).describe("Exact existing text to replace (copy it from read_file)"),
        replace: z.string().describe("New text"),
        all: z.boolean().optional().describe("Replace every match instead of requiring a unique one"),
      }),
      execute: async ({ path, find, replace, all }) => runEdits(path, [{ find, replace, all }], "tool.edit_file"),
    }),
    patch_file: tool({
      description: "Apply several find/replace edits to one file in a single call. Each find must match exactly once (unless all=true).",
      inputSchema: z.object({
        path: z.string(),
        edits: z.array(z.object({ find: z.string().min(1), replace: z.string(), all: z.boolean().optional() })).min(1).max(40),
      }),
      execute: async ({ path, edits }) => runEdits(path, edits, "tool.patch_file"),
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

export type SecretStore = {
  listKeys: () => Promise<string[]>;
};

/** Reads which API keys the project already has saved (names only, never values). */
export function createSupabaseSecretStore(supabase: SupabaseLike, projectId: string): SecretStore {
  return {
    async listKeys() {
      const { data } = await supabase.from("project_secrets").select("key").eq("project_id", projectId);
      return (data ?? []).map((row: { key: string }) => row.key);
    },
  };
}

/**
 * Lets the agent ask the user for an API key instead of failing or writing a
 * fake placeholder. The chat UI turns a `needsInput` result into a secure
 * paste box; the value is saved encrypted in the project's secrets.
 */
export function createSecretTools(store: SecretStore, trace?: TraceLogger) {
  return {
    list_secrets: tool({
      description:
        "List the names of API keys/secrets already saved for this project (values are never shown). Call this before assuming a key is missing.",
      inputSchema: z.object({}),
      execute: async () => {
        const keys = await store.listKeys();
        trace?.log("tool.list_secrets", { detail: { count: keys.length } });
        return { keys };
      },
    }),
    request_secret: tool({
      description:
        "Ask the user to paste an API key or secret this feature needs. Shows the user a secure paste box in chat. Use SCREAMING_SNAKE_CASE names like OPENAI_API_KEY or STRIPE_SECRET_KEY.",
      inputSchema: z.object({
        key: z.string().describe("Secret name, e.g. OPENAI_API_KEY"),
        reason: z.string().describe("One plain-English sentence explaining what it is used for"),
        where_to_get: z.string().optional().describe("Where the user can find/create this key"),
      }),
      execute: async ({ key, reason, where_to_get }) => {
        const name = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        const existing = await store.listKeys();
        if (existing.includes(name)) {
          trace?.log("tool.request_secret", { detail: { key: name, alreadySaved: true } });
          return { key: name, alreadySaved: true, needsInput: false, message: `${name} is already saved for this project.` };
        }
        trace?.log("tool.request_secret", { detail: { key: name, alreadySaved: false } });
        return {
          key: name,
          alreadySaved: false,
          needsInput: true,
          reason,
          where_to_get: where_to_get ?? null,
          message:
            `A secure paste box for ${name} is now shown to the user in the chat. Continue building the feature and read the key from the project's secrets at runtime — never hardcode a placeholder value.`,
        };
      },
    }),
  };
}

