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
    execute_sql: tool({
      description:
        "Run SQL (DDL like CREATE TABLE IF NOT EXISTS / ALTER TABLE / CREATE POLICY, or DML) on this project's connected Supabase database. Use it when a table is missing instead of telling the user to do it. Always enable RLS and add policies on new tables.",
      inputSchema: z.object({ sql: z.string().min(3).max(50000) }),
      execute: async ({ sql }) => {
        const r = await runProjectSql(opts.projectId, sql);
        log("tool.execute_sql", { ok: r.ok });
        return r;
      },
    }),
    attach_credential: tool({
      description:
        "Copy a credential from the admin vault into this project's secrets under a given env name (e.g. VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY). part chooses key, url or id.",
      inputSchema: z.object({
        label: z.string().min(1),
        secretName: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
        part: z.enum(["key", "url", "id"]).optional(),
      }),
      execute: async ({ label, secretName, part }) => {
        const { readVaultSecret } = await import("./admin-vault.server");
        const cred = await readVaultSecret(label);
        if (!cred) return { ok: false, error: `No vault credential named "${label}".` };
        const value = part === "url" ? cred.base_url : part === "id" ? cred.account_id : cred.key;
        if (!value) return { ok: false, error: `That credential has no ${part}.` };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { encryptSecret } = await import("./secrets-crypto.server");
        const { error } = await supabaseAdmin.from("project_secrets").upsert(
          {
            project_id: opts.projectId,
            user_id: opts.userId,
            key: secretName,
            value_encrypted: await encryptSecret(value),
            expose_to_client: secretName.startsWith("VITE_"),
            description: `From vault: ${cred.label}`,
          },
          { onConflict: "project_id,key" },
        );
        log("tool.attach_credential", { ok: !error, secretName });
        return error ? { ok: false, error: error.message } : { ok: true, saved: secretName };
      },
    }),
  };
}

async function projectSecret(projectId: string, keys: string[]) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptSecret } = await import("./secrets-crypto.server");
  const { data } = await supabaseAdmin
    .from("project_secrets")
    .select("key, value_encrypted")
    .eq("project_id", projectId)
    .in("key", keys);
  for (const k of keys) {
    const row = (data ?? []).find((r) => r.key === k);
    if (row) {
      try {
        return await decryptSecret(row.value_encrypted);
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

/** Runs SQL via the Supabase Management API (access token) or an exec_sql RPC (service key). */
export async function runProjectSql(projectId: string, sql: string) {
  const url = await projectSecret(projectId, ["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) return { ok: false, error: "No Supabase connected to this project. Ask the user to connect one (or attach_credential from the vault)." };
  const ref = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url)?.[1];
  const accessToken = await projectSecret(projectId, ["SUPABASE_ACCESS_TOKEN"]);
  if (accessToken && ref) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    return res.ok ? { ok: true, result: text.slice(0, 4000) } : { ok: false, error: `${res.status}: ${text.slice(0, 600)}` };
  }
  const serviceKey = await projectSecret(projectId, ["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!serviceKey) {
    return {
      ok: false,
      error:
        "Need SUPABASE_ACCESS_TOKEN (personal access token from supabase.com/dashboard/account/tokens) or SUPABASE_SERVICE_ROLE_KEY. Use request_secret to ask for SUPABASE_ACCESS_TOKEN.",
    };
  }
  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (res.ok) return { ok: true, result: text.slice(0, 4000) };
  return {
    ok: false,
    error: `${res.status}: ${text.slice(0, 400)}`,
    fix: "The database has no exec_sql helper. Ask the user for SUPABASE_ACCESS_TOKEN (request_secret), or to run once in their SQL editor: create or replace function public.exec_sql(query text) returns json language plpgsql security definer as $$ begin execute query; return json_build_object('ok', true); end $$; revoke all on function public.exec_sql(text) from public, anon, authenticated;",
  };
}
