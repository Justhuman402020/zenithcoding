import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { currentOrigin, encodeReturnOrigin, getCanonicalCallbackUrl } from "@/lib/github-shared";
import { cleanGithubPathPart, isCloseGithubProjectName, readGithubBlobBatch, readGithubRepoFiles, readGithubRepoTree } from "@/lib/github-import.server";
import { z } from "zod";

export const getGithubAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin?: string } | undefined) => input ?? {})
  .handler(async ({ context, data: input }) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId) throw new Error("GitHub OAuth not configured");
    const { data, error } = await context.supabase
      .from("github_oauth_states" as any)
      .insert({ user_id: context.userId })
      .select("state")
      .single();
    if (error || !data) throw new Error(error?.message || "Could not create OAuth state");
    const returnOrigin = input?.origin || currentOrigin(getRequest());
    const stateParam = `${(data as any).state}.${encodeReturnOrigin(returnOrigin)}`;
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", getCanonicalCallbackUrl());
    url.searchParams.set("scope", "repo read:user");
    url.searchParams.set("state", stateParam);
    return { url: url.toString() };
  });

export const getGithubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token, github_login, scope")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { connected: false, login: null, scope: null };
    const row = data as any;
    if (row.github_login) return { connected: true, login: row.github_login as string, scope: row.scope ?? null };

    const me = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${row.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (me.status === 401 || me.status === 403) {
      await context.supabase.from("github_tokens" as any).delete().eq("user_id", context.userId);
      return { connected: false, login: null, scope: null };
    }
    const profile = me.ok ? await me.json().catch(() => null) : null;
    const login = typeof profile?.login === "string" ? profile.login : null;
    if (login) {
      await context.supabase
        .from("github_tokens" as any)
        .update({ github_login: login, updated_at: new Date().toISOString() })
        .eq("user_id", context.userId);
    }
    return { connected: true, login, scope: row.scope ?? null };
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

export const importGithubRepoServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { owner: string; repo: string; branch?: string; subpath?: string }) => d)
  .handler(async ({ data, context }) => {
    const owner = data.owner.trim();
    const repo = data.repo.trim().replace(/\.git$/i, "");
    // Resume: if this user has already imported this repo, reopen it instead of duplicating.
    const { data: existingLink } = await context.supabase
      .from("project_github_links" as any)
      .select("project_id")
      .eq("user_id", context.userId)
      .ilike("owner", owner)
      .ilike("repo", repo)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingLink && (existingLink as any).project_id) {
      return {
        projectId: (existingLink as any).project_id as string,
        branch: data.branch || "",
        fileCount: 0,
        resumed: true,
      };
    }

    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;
    return readGithubRepoFiles({ ...data, owner, repo, token });
  });

export const importGithubRepoAsProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { owner: string; repo: string; branch?: string; subpath?: string }) => d)
  .handler(async ({ data, context }) => {
    const owner = data.owner.trim();
    const repo = data.repo.trim().replace(/\.git$/i, "");
    const { data: existingLink } = await context.supabase
      .from("project_github_links" as any)
      .select("project_id, default_branch")
      .eq("user_id", context.userId)
      .ilike("owner", owner)
      .ilike("repo", repo)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingLink && (existingLink as any).project_id) {
      return {
        projectId: (existingLink as any).project_id as string,
        branch: (existingLink as any).default_branch || data.branch || "",
        fileCount: 0,
        resumed: true,
      };
    }

    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;
    const { branch, files } = await readGithubRepoFiles({ ...data, owner, repo, token });
    const subpath = (data.subpath || "").replace(/^\/+|\/+$/g, "");
    const projectName = subpath ? `${repo}/${subpath.split("/").pop()}` : repo;

    // Continue an existing Lovable-tracked project with the same/similar name instead of making the user start fresh.
    const { data: namedProject } = await context.supabase
      .from("projects" as any)
      .select("id, name")
      .eq("user_id", context.userId)
      .not("lovable_project_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(50);

    const projectMatch = ((namedProject as any[]) || []).find((project) =>
      isCloseGithubProjectName(project.name || "", projectName) ||
      isCloseGithubProjectName(project.name || "", repo),
    );

    let projectId = projectMatch?.id as string | undefined;
    const continuedExistingProject = !!projectId;

    if (!projectId) {
      const { data: project, error: projectError } = await context.supabase
        .from("projects" as any)
        .insert({
          name: projectName,
          description: `Imported from github.com/${owner}/${repo}@${branch}`,
          user_id: context.userId,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(projectError?.message || "Could not create project");
      projectId = (project as any).id as string;
    } else {
      await context.supabase
        .from("projects" as any)
        .update({ description: `Imported from github.com/${owner}/${repo}@${branch}` })
        .eq("id", projectId)
        .eq("user_id", context.userId);
    }
    if (!projectId) throw new Error("Could not create project");

    const rows = files.map((file) => ({
      project_id: projectId,
      user_id: context.userId,
      path: file.path,
      content: file.content,
    }));

    if (!rows.some((row) => row.path === "index.html")) {
      const candidate = rows.find((row) => /(^|\/)index\.html$/i.test(row.path)) || rows.find((row) => /\.html?$/i.test(row.path));
      if (candidate) rows.unshift({ ...candidate, path: "index.html" });
      else rows.push({
        project_id: projectId,
        user_id: context.userId,
        path: "index.html",
        content: `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${projectName}</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#e7d18a}main{max-width:720px;padding:32px}code{color:#f0d78c}</style></head><body><main><h1>${projectName}</h1><p>This repository was imported from <code>github.com/${owner}/${repo}</code>. Edit the source files with AI or open the Code tab.</p></main></body></html>`,
      });
    }

    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await context.supabase
        .from("files" as any)
        .upsert(rows.slice(i, i + 50), { onConflict: "project_id,path" });
      if (error) {
        if (!continuedExistingProject) await context.supabase.from("projects" as any).delete().eq("id", projectId);
        throw new Error(error.message);
      }
    }

    // Remember GitHub origin so the user can push back later
    const { error: linkError } = await context.supabase
      .from("project_github_links" as any)
      .upsert({
        project_id: projectId,
        user_id: context.userId,
        owner,
        repo,
        default_branch: branch,
      }, { onConflict: "project_id" });
    if (linkError) throw new Error(linkError.message);

    return { projectId, branch, fileCount: rows.length, resumed: continuedExistingProject };
  });

// ============= Push to GitHub =============

export const getProjectGithubLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: link } = await context.supabase
      .from("project_github_links" as any)
      .select("owner, repo, default_branch, last_pushed_branch, last_pushed_sha, last_pushed_message, last_pushed_at")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    return link ? (link as any) : null;
  });

export const listProjectGithubBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: link } = await context.supabase
      .from("project_github_links" as any)
      .select("owner, repo, default_branch")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!link) throw new Error("This project is not linked to a GitHub repository.");
    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tok) throw new Error("Connect GitHub first");
    const token = (tok as any).access_token as string;
    const l = link as any;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const branches: { name: string; sha: string }[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const r = await fetch(
        `https://api.github.com/repos/${cleanGithubPathPart(l.owner)}/${cleanGithubPathPart(l.repo)}/branches?per_page=100&page=${page}`,
        { headers },
      );
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`GitHub error ${r.status}: ${body.slice(0, 200) || r.statusText}`);
      }
      const batch = (await r.json()) as any[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const b of batch) branches.push({ name: b.name, sha: b.commit?.sha });
      if (batch.length < 100) break;
    }
    return {
      owner: l.owner as string,
      repo: l.repo as string,
      default_branch: l.default_branch as string,
      branches,
    };
  });

export const pushProjectToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    projectId: string;
    branch: string;
    message: string;
    createBranch?: boolean;
    fromBranch?: string;
  }) => d)
  .handler(async ({ data, context }) => {
    const branch = data.branch.trim();
    const message = data.message.trim();
    if (!branch) throw new Error("Pick or name a branch");
    if (!/^[\w.\-\/]+$/.test(branch)) throw new Error("Invalid branch name");
    if (!message) throw new Error("Write a commit message");

    const { data: link } = await context.supabase
      .from("project_github_links" as any)
      .select("owner, repo, default_branch")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!link) throw new Error("This project is not linked to a GitHub repository.");
    const l = link as any;

    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tok) throw new Error("Connect GitHub first");
    const token = (tok as any).access_token as string;

    const { data: filesRows, error: filesErr } = await context.supabase
      .from("files" as any)
      .select("path, content")
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId);
    if (filesErr) throw new Error(filesErr.message);
    const files = (filesRows || []) as unknown as { path: string; content: string }[];
    if (files.length === 0) throw new Error("No files to push");
    if (files.length > 800) throw new Error("Too many files to push in one commit (max 800)");

    const owner = cleanGithubPathPart(l.owner);
    const repo = cleanGithubPathPart(l.repo);
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
    async function gh<T = any>(path: string, init?: RequestInit): Promise<T> {
      const r = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`GitHub ${r.status}: ${body.slice(0, 240) || r.statusText}`);
      }
      return r.json() as Promise<T>;
    }

    // Resolve branch ref; optionally create it from another branch
    let refSha: string | null = null;
    const refRes = await fetch(`${base}/git/ref/heads/${cleanGithubPathPart(branch)}`, { headers });
    if (refRes.ok) {
      refSha = (await refRes.json()).object?.sha ?? null;
    } else if (refRes.status === 404) {
      if (!data.createBranch) throw new Error(`Branch "${branch}" does not exist on GitHub. Enable "Create new branch" to add it.`);
      const sourceBranch = (data.fromBranch || l.default_branch || "main").trim();
      const sourceRef = await gh<any>(`/git/ref/heads/${cleanGithubPathPart(sourceBranch)}`);
      const sourceSha = sourceRef.object?.sha as string;
      await gh(`/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: sourceSha }),
      });
      refSha = sourceSha;
    } else {
      const body = await refRes.text().catch(() => "");
      throw new Error(`GitHub ${refRes.status}: ${body.slice(0, 240) || refRes.statusText}`);
    }
    if (!refSha) throw new Error("Could not resolve base commit");

    const baseCommit = await gh<any>(`/git/commits/${refSha}`);
    const baseTreeSha = baseCommit.tree?.sha as string;

    // Create blobs (parallel, capped)
    const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
    let idx = 0;
    async function blobWorker() {
      while (idx < files.length) {
        const i = idx++;
        const f = files[i];
        const b = await gh<any>(`/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" }),
        });
        treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
      }
    }
    await Promise.all(Array.from({ length: 6 }, blobWorker));

    const newTree = await gh<any>(`/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    const commit = await gh<any>(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: newTree.sha, parents: [refSha] }),
    });
    await gh(`/git/refs/heads/${cleanGithubPathPart(branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    await context.supabase
      .from("project_github_links" as any)
      .update({
        last_pushed_branch: branch,
        last_pushed_sha: commit.sha,
        last_pushed_message: message,
        last_pushed_at: new Date().toISOString(),
      })
      .eq("project_id", data.projectId)
      .eq("user_id", context.userId);

    return {
      ok: true,
      sha: commit.sha as string,
      branch,
      url: `https://github.com/${l.owner}/${l.repo}/commit/${commit.sha}`,
      fileCount: files.length,
    };
  });

// ============= Mirror every GitHub repo into Forge =============

// Imports up to MIRROR_BATCH missing repos per call. Re-call until `remaining` is 0.
export const mirrorAllGithubRepos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const MIRROR_BATCH = 6;
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

    // 1. List every repo the user can see (owner + collaborator + org).
    const allRepos: { full_name: string; default_branch: string; updated_at?: string }[] = [];
    const seen = new Set<string>();
    for (
      const baseUrl of [
        "https://api.github.com/user/repos?sort=updated&affiliation=owner,collaborator,organization_member",
        "https://api.github.com/user/repos?sort=updated&type=all",
      ]
    ) {
      for (let page = 1; page <= 20; page += 1) {
        const url = `${baseUrl}&per_page=100&page=${page}`;
        const r = await fetch(url, { headers });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`GitHub ${r.status}: ${body.slice(0, 200) || r.statusText}`);
        }
        const batch = (await r.json()) as any[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const repo of batch) {
          if (!repo?.full_name || seen.has(repo.full_name)) continue;
          seen.add(repo.full_name);
          allRepos.push({
            full_name: repo.full_name,
            default_branch: repo.default_branch || "main",
            updated_at: repo.updated_at,
          });
        }
        const linkHdr = r.headers.get("link") ?? "";
        if (batch.length < 100 || !linkHdr.includes('rel="next"')) break;
      }
    }
    allRepos.sort(
      (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime(),
    );

    // 2. Determine which are already mirrored for this user.
    const { data: existingLinks } = await context.supabase
      .from("project_github_links" as any)
      .select("owner, repo")
      .eq("user_id", context.userId);
    const mirroredKeys = new Set(
      ((existingLinks as any[]) || []).map((l) => `${l.owner}/${l.repo}`.toLowerCase()),
    );

    const missing = allRepos.filter((r) => !mirroredKeys.has(r.full_name.toLowerCase()));
    const batch = missing.slice(0, MIRROR_BATCH);

    const imported: { full_name: string; projectId: string; fileCount: number }[] = [];
    const failed: { full_name: string; error: string }[] = [];

    for (const repo of batch) {
      const [owner, name] = repo.full_name.split("/");
      try {
        const { branch, files } = await readGithubRepoFiles({
          owner,
          repo: name,
          branch: repo.default_branch,
          token,
        });
        const { data: project, error: projectError } = await context.supabase
          .from("projects" as any)
          .insert({
            name: name,
            description: `Mirrored from github.com/${repo.full_name}@${branch}`,
            user_id: context.userId,
          })
          .select("id")
          .single();
        if (projectError || !project) throw new Error(projectError?.message || "Could not create project");
        const projectId = (project as any).id as string;

        const rows = files.map((file) => ({
          project_id: projectId,
          user_id: context.userId,
          path: file.path,
          content: file.content,
        }));
        if (!rows.some((row) => row.path === "index.html")) {
          const candidate =
            rows.find((row) => /(^|\/)index\.html$/i.test(row.path)) ||
            rows.find((row) => /\.html?$/i.test(row.path));
          if (candidate) rows.unshift({ ...candidate, path: "index.html" });
        }
        for (let i = 0; i < rows.length; i += 50) {
          const { error } = await context.supabase
            .from("files" as any)
            .insert(rows.slice(i, i + 50));
          if (error) {
            await context.supabase.from("projects" as any).delete().eq("id", projectId);
            throw new Error(error.message);
          }
        }
        await context.supabase.from("project_github_links" as any).insert({
          project_id: projectId,
          user_id: context.userId,
          owner,
          repo: name,
          default_branch: branch,
        });
        imported.push({ full_name: repo.full_name, projectId, fileCount: rows.length });
      } catch (e: any) {
        failed.push({ full_name: repo.full_name, error: e?.message || "import failed" });
      }
    }

    const remaining = Math.max(0, missing.length - batch.length);
    return {
      total: allRepos.length,
      alreadyMirrored: allRepos.length - missing.length,
      missing: missing.length,
      imported,
      failed,
      remaining,
    };
  });

// ============= Fast two-phase import =============
// Phase 1: create project + link + fetch tree only. Returns quickly so the
// client can redirect immediately. Phase 2: client streams blob batches.

export const startGithubImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { owner: string; repo: string; branch?: string; subpath?: string }) => d)
  .handler(async ({ data, context }) => {
    const owner = data.owner.trim();
    const repo = data.repo.trim().replace(/\.git$/i, "");

    const { data: existingLink } = await context.supabase
      .from("project_github_links" as any)
      .select("project_id, default_branch")
      .eq("user_id", context.userId)
      .ilike("owner", owner)
      .ilike("repo", repo)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;

    const { branch, blobs, stripPrefix } = await readGithubRepoTree({
      owner, repo, branch: data.branch, subpath: data.subpath, token,
    });

    let projectId: string | undefined = (existingLink as any)?.project_id;
    let resumed = !!projectId;

    if (!projectId) {
      const subpath = (data.subpath || "").replace(/^\/+|\/+$/g, "");
      const projectName = subpath ? `${repo}/${subpath.split("/").pop()}` : repo;
      const { data: namedProject } = await context.supabase
        .from("projects" as any)
        .select("id, name")
        .eq("user_id", context.userId)
        .not("lovable_project_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      const match = ((namedProject as any[]) || []).find((p) =>
        isCloseGithubProjectName(p.name || "", projectName) ||
        isCloseGithubProjectName(p.name || "", repo),
      );
      if (match?.id) {
        projectId = match.id as string;
        resumed = true;
        await context.supabase
          .from("projects" as any)
          .update({ description: `Imported from github.com/${owner}/${repo}@${branch}` })
          .eq("id", projectId)
          .eq("user_id", context.userId);
      } else {
        const { data: project, error } = await context.supabase
          .from("projects" as any)
          .insert({
            name: projectName,
            description: `Importing from github.com/${owner}/${repo}@${branch}…`,
            user_id: context.userId,
          })
          .select("id")
          .single();
        if (error || !project) throw new Error(error?.message || "Could not create project");
        projectId = (project as any).id as string;

        // Seed an index.html so the preview isn't empty during hydration.
        await context.supabase.from("files" as any).insert({
          project_id: projectId,
          user_id: context.userId,
          path: "index.html",
          content: `<!doctype html><html><head><meta charset="utf-8"/><title>${projectName}</title><style>body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#e7d18a;text-align:center;padding:32px}h1{margin:0 0 8px}p{color:#c9c1a4}</style></head><body><main><h1>${projectName}</h1><p>Syncing files from github.com/${owner}/${repo}…</p></main></body></html>`,
        });
      }
    }

    await context.supabase
      .from("project_github_links" as any)
      .upsert({
        project_id: projectId,
        user_id: context.userId,
        owner,
        repo,
        default_branch: branch,
      }, { onConflict: "project_id" });

    return { projectId: projectId!, branch, resumed, stripPrefix, blobs, owner, repo };
  });

export const fetchGithubBlobBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    projectId: string;
    owner: string;
    repo: string;
    stripPrefix?: string;
    blobs: { path: string; sha: string }[];
  }) => d)
  .handler(async ({ data, context }) => {
    // Verify the caller owns this project.
    const { data: proj } = await context.supabase
      .from("projects" as any)
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!proj) throw new Error("Project not found");

    const { data: tok } = await context.supabase
      .from("github_tokens" as any)
      .select("access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const token = (tok as any)?.access_token as string | undefined;

    const files = await readGithubBlobBatch({
      owner: data.owner,
      repo: data.repo,
      blobs: data.blobs,
      stripPrefix: data.stripPrefix,
      token,
    });
    if (files.length === 0) return { saved: 0 };

    const rows = files.map((f) => ({
      project_id: data.projectId,
      user_id: context.userId,
      path: f.path,
      content: f.content,
    }));
    const { error } = await context.supabase
      .from("files" as any)
      .upsert(rows, { onConflict: "project_id,path" });
    if (error) throw new Error(error.message);
    return { saved: rows.length };
  });