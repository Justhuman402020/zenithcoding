// Reads admin-saved integration keys (Admin → Integrations & API keys).
// Falls back to a same-named environment secret when nothing is saved.
const ENV_FALLBACK: Record<string, string> = {
  "tavily.apiKey": "TAVILY_API_KEY",
  "unsplash.accessKey": "UNSPLASH_ACCESS_KEY",
  "github.token": "GITHUB_PAT",
  "e2b.apiKey": "E2B_API_KEY",
  "neon.apiKey": "NEON_API_KEY",
  "openrouter.apiKey": "OPENROUTER_API_KEY",
};

export async function getIntegrationKey(service: string, field: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./secrets-crypto.server");
    const { data } = await supabaseAdmin
      .from("platform_integration_keys" as any)
      .select("value_encrypted")
      .eq("service", service)
      .eq("field", field)
      .maybeSingle();
    const enc = (data as any)?.value_encrypted as string | undefined;
    if (enc) {
      const v = (await decryptSecret(enc)).trim().replace(/^Bearer\s+/i, "");
      if (v) return v;
    }
  } catch {
    /* fall through to env */
  }
  const env = ENV_FALLBACK[`${service}.${field}`];
  const v = env ? (process.env[env] ?? "").trim() : "";
  return v || null;
}

export async function tavilySearch(query: string, maxResults = 5) {
  const key = await getIntegrationKey("tavily", "apiKey");
  if (!key) return { ok: false as const, error: "Tavily key not saved in Admin → Integrations." };
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query, max_results: Math.min(Math.max(maxResults, 1), 10), include_answer: true }),
  });
  if (!res.ok) return { ok: false as const, error: `Tavily ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = (await res.json()) as any;
  return {
    ok: true as const,
    answer: j.answer ?? null,
    results: ((j.results ?? []) as any[]).map((r) => ({
      title: r.title,
      url: r.url,
      content: String(r.content ?? "").slice(0, 1200),
    })),
  };
}

export async function unsplashSearch(query: string, count = 6) {
  const key = await getIntegrationKey("unsplash", "accessKey");
  if (!key) return { ok: false as const, error: "Unsplash key not saved in Admin → Integrations." };
  const url = `https://api.unsplash.com/search/photos?per_page=${Math.min(Math.max(count, 1), 20)}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (!res.ok) return { ok: false as const, error: `Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = (await res.json()) as any;
  return {
    ok: true as const,
    images: ((j.results ?? []) as any[]).map((p) => ({
      url: `${p.urls?.raw}&w=1920&q=80&auto=format&fit=crop`,
      thumb: p.urls?.small,
      alt: p.alt_description ?? p.description ?? query,
      credit: `Photo by ${p.user?.name ?? "Unknown"} on Unsplash`,
      creditUrl: p.links?.html,
    })),
  };
}

/** Creates a Neon Postgres project and returns its connection string. */
export async function neonCreateDatabase(name: string) {
  const key = await getIntegrationKey("neon", "apiKey");
  if (!key) return { ok: false as const, error: "Neon key not saved in Admin → Integrations." };
  const res = await fetch("https://console.neon.tech/api/v2/projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: { name: name.slice(0, 60) || "forge-project" } }),
  });
  if (!res.ok) return { ok: false as const, error: `Neon ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = (await res.json()) as any;
  const uri = j.connection_uris?.[0]?.connection_uri as string | undefined;
  if (!uri) return { ok: false as const, error: "Neon created the project but returned no connection string." };
  return { ok: true as const, neonProjectId: j.project?.id as string, connectionUri: uri };
}

export type E2BSandbox = { id: string; host: string; token?: string; key: string };

/** Starts a reusable E2B sandbox that shuts itself down after `timeoutSec` without an extension. */
export async function e2bCreateSandbox(timeoutSec = 600): Promise<{ ok: true; sandbox: E2BSandbox } | { ok: false; error: string }> {
  const key = await getIntegrationKey("e2b", "apiKey");
  if (!key) return { ok: false, error: "E2B key not saved in Admin → Integrations." };
  const create = await fetch("https://api.e2b.dev/sandboxes", {
    method: "POST",
    headers: { "X-API-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ templateID: "code-interpreter-v1", timeout: timeoutSec }),
  });
  if (!create.ok) return { ok: false, error: `E2B ${create.status}: ${(await create.text()).slice(0, 200)}` };
  const sb = (await create.json()) as any;
  return { ok: true, sandbox: { id: sb.sandboxID, host: `https://49999-${sb.sandboxID}.${sb.domain ?? "e2b.app"}`, token: sb.envdAccessToken, key } };
}

/** Pushes the sandbox's self-shutdown time out again; false when it is already gone. */
export async function e2bExtend(sb: E2BSandbox, timeoutSec = 600): Promise<boolean> {
  try {
    const r = await fetch(`https://api.e2b.dev/sandboxes/${sb.id}/timeout`, { method: "POST", headers: { "X-API-Key": sb.key, "content-type": "application/json" }, body: JSON.stringify({ timeout: timeoutSec }), signal: AbortSignal.timeout(15_000) });
    return r.ok;
  } catch { return false; }
}

export async function e2bKill(sb: E2BSandbox) {
  await fetch(`https://api.e2b.dev/sandboxes/${sb.id}`, { method: "DELETE", headers: { "X-API-Key": sb.key } }).catch(() => {});
}

/** Runs code in an existing sandbox's kernel. `gone` means the sandbox no longer answers. */
export async function e2bExecute(sb: E2BSandbox, code: string, opts: { timeoutSec?: number; maxOut?: number } = {}) {
  let res: Response;
  try {
    res = await fetch(`${sb.host}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sb.token ? { "X-Access-Token": sb.token } : {}) },
      body: JSON.stringify({ code, language: "python" }),
      signal: AbortSignal.timeout(((opts.timeoutSec ?? 120) + 15) * 1000),
    });
  } catch (e) {
    return { ok: false as const, gone: false, error: e instanceof Error ? e.message : "sandbox did not answer" };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false as const, gone: res.status === 502 || res.status === 404, error: `E2B run ${res.status}: ${raw.slice(0, 200)}` };
  const out: string[] = [];
  const errs: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "stdout" || ev.type === "result") out.push(String(ev.text ?? ""));
      else if (ev.type === "stderr") errs.push(String(ev.text ?? ""));
      else if (ev.type === "error") errs.push(`${ev.name}: ${ev.value}`);
    } catch { out.push(line); }
  }
  return { ok: true as const, stdout: out.join("").slice(-(opts.maxOut ?? 8000)), stderr: errs.join("").slice(0, 4000) };
}

/** Runs code in a short-lived E2B cloud sandbox (Code Interpreter template). */
export async function e2bRunCode(code: string, language: "python" | "js" = "python", opts: { timeoutSec?: number; maxOut?: number } = {}) {
  const key = await getIntegrationKey("e2b", "apiKey");
  if (!key) return { ok: false as const, error: "E2B key not saved in Admin → Integrations." };
  const create = await fetch("https://api.e2b.dev/sandboxes", {
    method: "POST",
    headers: { "X-API-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ templateID: "code-interpreter-v1", timeout: opts.timeoutSec ?? 120 }),
  });
  if (!create.ok) return { ok: false as const, error: `E2B ${create.status}: ${(await create.text()).slice(0, 200)}` };
  const sb = (await create.json()) as any;
  const id = sb.sandboxID as string;
  const host = `https://49999-${id}.${sb.domain ?? "e2b.app"}`;
  try {
    const res = await fetch(`${host}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sb.envdAccessToken ? { "X-Access-Token": sb.envdAccessToken } : {}),
      },
      body: JSON.stringify({ code, language }),
      signal: AbortSignal.timeout(((opts.timeoutSec ?? 120) + 15) * 1000),
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false as const, error: `E2B run ${res.status}: ${raw.slice(0, 200)}` };
    const out: string[] = [];
    const errs: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "stdout" || ev.type === "result") out.push(String(ev.text ?? ""));
        else if (ev.type === "stderr") errs.push(String(ev.text ?? ""));
        else if (ev.type === "error") errs.push(`${ev.name}: ${ev.value}`);
      } catch {
        out.push(line);
      }
    }
    return { ok: true as const, stdout: out.join("").slice(-(opts.maxOut ?? 8000)), stderr: errs.join("").slice(0, 4000) };
  } finally {
    void fetch(`https://api.e2b.dev/sandboxes/${id}`, { method: "DELETE", headers: { "X-API-Key": key } }).catch(() => {});
  }
}
