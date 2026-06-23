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
      .select("access_token, scope")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tok) throw new Error("Connect GitHub first");
    const token = (tok as any).access_token as string;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    async function fetchRepoPages(baseUrl: string) {
      const repos: any[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}per_page=100&page=${page}`;
        const r = await fetch(url, { headers });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`GitHub error ${r.status}: ${body.slice(0, 240) || r.statusText}`);
        }
        const batch = (await r.json()) as any[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        repos.push(...batch);
        const link = r.headers.get("link") ?? "";
        if (batch.length < 100 || !link.includes('rel="next"')) break;
      }
      return repos;
    }

    const all: any[] = [];
    const seen = new Set<string>();
    const sources = [
      "https://api.github.com/user/repos?sort=updated&affiliation=owner,collaborator,organization_member",
      "https://api.github.com/user/repos?sort=updated&type=all",
    ];
    for (const source of sources) {
      const batch = await fetchRepoPages(source);
      for (const repo of batch) {
        if (!repo?.full_name || seen.has(repo.full_name)) continue;
        seen.add(repo.full_name);
        all.push(repo);
      }
    }

    all.sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());

    if (all.length === 0 && !String((tok as any).scope ?? "").split(/[,\s]+/).includes("repo")) {
      throw new Error("GitHub is connected without private repo access. Disconnect and connect again so Forge can request repo access.");
    }

    return all.map((r) => ({
      full_name: r.full_name as string,
      private: r.private as boolean,
      default_branch: r.default_branch as string,
      description: r.description as string | null,
      updated_at: r.updated_at as string,
    }));
  });

type ImportedFile = { path: string; content: string };

function cleanGithubPathPart(value: string) {
  return encodeURIComponent(value.trim()).replace(/%2F/g, "/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readGithubRepoFiles({
  owner,
  repo,
  branch,
  subpath,
  token,
}: {
  owner: string;
  repo: string;
  branch?: string;
  subpath?: string;
  token?: string;
}) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  owner = owner.trim();
  repo = repo.trim().replace(/\.git$/i, "");
  subpath = (subpath || "").replace(/^\/+|\/+$/g, "");
  if (!owner || !repo || owner.includes("..") || repo.includes("..")) throw new Error("Invalid GitHub repository");

  let resolvedBranch = branch?.trim();
  if (!resolvedBranch) {
    const mr = await fetch(`https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}`, { headers });
    if (!mr.ok) {
      const body = await mr.text().catch(() => "");
      throw new Error(`Repo not found (${mr.status}): ${body.slice(0, 160) || mr.statusText}`);
    }
    resolvedBranch = (await mr.json()).default_branch || "main";
  }

  const treeUrl = `https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}/git/trees/${cleanGithubPathPart(resolvedBranch)}?recursive=1`;
  const tr = await fetch(treeUrl, { headers });
  if (!tr.ok) {
    const body = await tr.text().catch(() => "");
    throw new Error(`Tree read failed (${tr.status}): ${body.slice(0, 180) || tr.statusText}`);
  }
  const tree = await tr.json();
  if (!tree.tree) throw new Error("Empty repo");

  const blobs: { path: string; sha: string; size: number }[] = tree.tree
    .filter((n: any) => n.type === "blob")
    .filter((n: any) => !subpath || n.path.startsWith(subpath + "/") || n.path === subpath)
    .filter((n: any) => !SKIP_DIR.test("/" + n.path + "/"))
    .filter((n: any) => ALLOWED.test(n.path))
    .filter((n: any) => (n.size ?? 0) < 250_000)
    .slice(0, 600);

  if (blobs.length === 0) throw new Error("No importable text files found in this repo or subfolder");

  const stripPrefix = (p: string) => (subpath ? p.replace(new RegExp(`^${escapeRegExp(subpath)}/?`), "") : p);
  const files: ImportedFile[] = [];
  let idx = 0;
  async function worker() {
    while (idx < blobs.length) {
      const i = idx++;
      const b = blobs[i];
      try {
        const r = await fetch(
          `https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}/git/blobs/${b.sha}`,
          { headers },
        );
        if (r.ok) {
          const j = await r.json();
          const content =
            j.encoding === "base64"
              ? Buffer.from(j.content, "base64").toString("utf8")
              : String(j.content ?? "");
          const path = stripPrefix(b.path);
          if (path) files.push({ path, content });
        }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { branch: resolvedBranch, files };
}

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
    return readGithubRepoFiles({ ...data, token });
  });

export const importGithubRepoAsProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { owner: string; repo: string; branch?: string; subpath?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;
    const { branch, files } = await readGithubRepoFiles({ ...data, token });
    const subpath = (data.subpath || "").replace(/^\/+|\/+$/g, "");
    const projectName = subpath ? `${data.repo}/${subpath.split("/").pop()}` : data.repo;

    const { data: project, error: projectError } = await context.supabase
      .from("projects" as any)
      .insert({
        name: projectName,
        description: `Imported from github.com/${data.owner}/${data.repo}@${branch}`,
        user_id: context.userId,
      })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(projectError?.message || "Could not create project");

    const rows = files.map((file) => ({
      project_id: (project as any).id,
      user_id: context.userId,
      path: file.path,
      content: file.content,
    }));

    if (!rows.some((row) => row.path === "index.html")) {
      const candidate = rows.find((row) => /(^|\/)index\.html$/i.test(row.path)) || rows.find((row) => /\.html?$/i.test(row.path));
      if (candidate) rows.unshift({ ...candidate, path: "index.html" });
      else rows.push({
        project_id: (project as any).id,
        user_id: context.userId,
        path: "index.html",
        content: `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${projectName}</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#e7d18a}main{max-width:720px;padding:32px}code{color:#f0d78c}</style></head><body><main><h1>${projectName}</h1><p>This repository was imported from <code>github.com/${data.owner}/${data.repo}</code>. Edit the source files with AI or open the Code tab.</p></main></body></html>`,
      });
    }

    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await context.supabase.from("files" as any).insert(rows.slice(i, i + 50));
      if (error) {
        await context.supabase.from("projects" as any).delete().eq("id", (project as any).id);
        throw new Error(error.message);
      }
    }

    return { projectId: (project as any).id as string, branch, fileCount: rows.length };
  });