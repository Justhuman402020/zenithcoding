import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";

function callbackUrl(req: Request | undefined) {
  const host = req?.headers.get("x-forwarded-host") || req?.headers.get("host") || "localhost:3000";
  const proto = req?.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}/api/public/github/callback`;
}

export const getGithubAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId) throw new Error("GitHub OAuth not configured");
    const { data, error } = await context.supabase
      .from("github_oauth_states" as any)
      .insert({ user_id: context.userId })
      .select("state")
      .single();
    if (error || !data) throw new Error(error?.message || "Could not create OAuth state");
    const redirectUri = callbackUrl(getRequest());
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "repo read:user");
    url.searchParams.set("state", (data as any).state);
    return { url: url.toString() };
  });

export const getGithubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("github_tokens" as any)
      .select("github_login")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { connected: !!data, login: (data as any)?.github_login ?? null };
  });

export const disconnectGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("github_tokens" as any).delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const listGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tok) throw new Error("Connect GitHub first");
    const token = (tok as any).access_token as string;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const all: any[] = [];
    // Paginate through up to 5 pages (500 repos) — covers virtually everyone.
    for (let page = 1; page <= 5; page += 1) {
      const url = `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`GitHub error ${r.status}: ${body.slice(0, 160) || r.statusText}`);
      }
      const batch = (await r.json()) as any[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all.map((r) => ({
      full_name: r.full_name as string,
      private: r.private as boolean,
      default_branch: r.default_branch as string,
      description: r.description as string | null,
      updated_at: r.updated_at as string,
    }));
  });

const ALLOWED = /\.(html?|css|js|jsx|ts|tsx|json|md|txt|svg|xml|yml|yaml|vue|astro|mjs|cjs)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|coverage)\//i;

export const importGithubRepoServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { owner: string; repo: string; branch?: string; subpath?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    let { owner, repo, branch, subpath } = data;
    subpath = (subpath || "").replace(/^\/+|\/+$/g, "");

    if (!branch) {
      const mr = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!mr.ok) throw new Error(`Repo not found (${mr.status})`);
      branch = (await mr.json()).default_branch || "main";
    }

    const tr = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
    if (!tr.ok) throw new Error(`Tree read failed (${tr.status})`);
    const tree = await tr.json();
    if (!tree.tree) throw new Error("Empty repo");

    const blobs: { path: string; sha: string; size: number }[] = tree.tree
      .filter((n: any) => n.type === "blob")
      .filter((n: any) => !subpath || n.path.startsWith(subpath + "/") || n.path === subpath)
      .filter((n: any) => !SKIP_DIR.test("/" + n.path + "/"))
      .filter((n: any) => ALLOWED.test(n.path))
      .filter((n: any) => (n.size ?? 0) < 250_000)
      .slice(0, 300);

    if (blobs.length === 0) throw new Error("No importable text files found");

    const stripPrefix = (p: string) => (subpath ? p.replace(new RegExp(`^${subpath}/?`), "") : p);
    const files: { path: string; content: string }[] = [];
    let idx = 0;
    async function worker() {
      while (idx < blobs.length) {
        const i = idx++;
        const b = blobs[i];
        try {
          const r = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/blobs/${b.sha}`,
            { headers },
          );
          if (r.ok) {
            const j = await r.json();
            const content =
              j.encoding === "base64"
                ? Buffer.from(j.content, "base64").toString("utf8")
                : String(j.content ?? "");
            files.push({ path: stripPrefix(b.path), content });
          }
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));

    return { branch, files };
  });