// Agent tools powered by the admin-saved integration keys.
import { tool } from "ai";
import { z } from "zod";
import type { TraceLogger } from "./trace.server";
import { e2bRunCode, neonCreateDatabase, tavilySearch, unsplashSearch } from "./integration-keys.server";

export function createIntegrationTools(opts: { projectId: string; userId: string; projectName: string; trace?: TraceLogger }) {
  const log = (phase: string, detail: Record<string, unknown>) => opts.trace?.log(phase, { detail });
  return {
    web_search: tool({
      description: "Search the web and documentation (Tavily). Use for up-to-date library docs, APIs, or facts.",
      inputSchema: z.object({ query: z.string().min(2), maxResults: z.number().int().min(1).max(10).optional() }),
      execute: async ({ query, maxResults }) => {
        const r = await tavilySearch(query, maxResults ?? 5);
        log("tool.web_search", { query, ok: r.ok });
        return r;
      },
    }),
    search_images: tool({
      description:
        "Find high-resolution Unsplash photos. Use the returned url directly in <img src> and include the credit text somewhere visible.",
      inputSchema: z.object({ query: z.string().min(2), count: z.number().int().min(1).max(20).optional() }),
      execute: async ({ query, count }) => {
        const r = await unsplashSearch(query, count ?? 6);
        log("tool.search_images", { query, ok: r.ok });
        return r;
      },
    }),
    run_code: tool({
      description: "Run a short Python or JavaScript snippet in a safe cloud sandbox (E2B) and get its output.",
      inputSchema: z.object({ code: z.string().min(1).max(20000), language: z.enum(["python", "js"]).optional() }),
      execute: async ({ code, language }) => {
        const r = await e2bRunCode(code, language ?? "python");
        log("tool.run_code", { ok: r.ok });
        return r;
      },
    }),
    create_database: tool({
      description:
        "Create a Neon Postgres database for this project. Saves the connection string as the server-only project secret DATABASE_URL. Only call when the user wants a Postgres database.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await neonCreateDatabase(`forge-${opts.projectName}`);
        log("tool.create_database", { ok: r.ok });
        if (!r.ok) return r;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { encryptSecret } = await import("./secrets-crypto.server");
        await supabaseAdmin.from("project_secrets").upsert(
          {
            project_id: opts.projectId,
            user_id: opts.userId,
            key: "DATABASE_URL",
            value_encrypted: await encryptSecret(r.connectionUri),
            expose_to_client: false,
            description: "Neon Postgres database",
          },
          { onConflict: "project_id,key" },
        );
        return { ok: true, saved: "DATABASE_URL", neonProjectId: r.neonProjectId };
      },
    }),
  };
}
