type ImportedFile = { path: string; content: string };
export type RepoTreeBlob = { path: string; sha: string; size: number };

const ALLOWED = /\.(html?|css|js|jsx|ts|tsx|json|md|txt|svg|xml|yml|yaml|vue|astro|mjs|cjs)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|coverage)\//i;

export function cleanGithubPathPart(value: string) {
  return encodeURIComponent(value.trim()).replace(/%2F/g, "/");
}

export function normalizeGithubProjectName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isCloseGithubProjectName(a: string, b: string) {
  const left = normalizeGithubProjectName(a);
  const right = normalizeGithubProjectName(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;

  const maxDistance = Math.max(left.length, right.length) <= 14 ? 2 : 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const next = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current[j] = next;
      rowMin = Math.min(rowMin, next);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }
  return previous[right.length] <= maxDistance;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readGithubRepoFiles({
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
  if (!owner || !repo || owner.includes("..") || repo.includes("..") || owner.includes("/") || repo.includes("/")) {
    throw new Error("Invalid GitHub repository");
  }

  let resolvedBranch = branch?.trim();
  if (!resolvedBranch) {
    const mr = await fetch(`https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}`, { headers });
    if (!mr.ok) {
      if (mr.status === 404) {
        const ownerRes = await fetch(
          `https://api.github.com/users/${cleanGithubPathPart(owner)}`,
          { headers },
        ).catch(() => null);
        if (ownerRes && ownerRes.status === 404) {
          throw new Error(
            `GitHub user or org "${owner}" doesn't exist. Check the spelling in the URL (https://github.com/${owner}/${repo}).`,
          );
        }
        if (token) {
          throw new Error(
            `Repo ${owner}/${repo} not found. It may be private and not visible to your connected GitHub account. Open the repo on github.com to confirm the exact owner/name, or grant access to that org/repo.`,
          );
        }
        throw new Error(
          `Repo ${owner}/${repo} not found or is private. Connect GitHub first (Import → Connect GitHub) so private repos become visible.`,
        );
      }
      const body = await mr.text().catch(() => "");
      throw new Error(`Could not read repo ${owner}/${repo} (${mr.status}): ${body.slice(0, 160) || mr.statusText}`);
    }
    resolvedBranch = (await mr.json()).default_branch || "main";
  }

  const treeBranch = resolvedBranch || "main";
  const treeUrl = `https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}/git/trees/${cleanGithubPathPart(treeBranch)}?recursive=1`;
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

  return { branch: treeBranch, files };
}

// Fast: fetch only the git tree — no blob contents. Used to bootstrap an import
// so the user gets redirected to their project instantly and blobs stream in
// afterwards in client-driven batches.
export async function readGithubRepoTree({
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
}): Promise<{ branch: string; blobs: RepoTreeBlob[]; stripPrefix: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  owner = owner.trim();
  repo = repo.trim().replace(/\.git$/i, "");
  subpath = (subpath || "").replace(/^\/+|\/+$/g, "");
  if (!owner || !repo || owner.includes("..") || repo.includes("..") || owner.includes("/") || repo.includes("/")) {
    throw new Error("Invalid GitHub repository");
  }

  let resolvedBranch = branch?.trim();
  if (!resolvedBranch) {
    const mr = await fetch(`https://api.github.com/repos/${cleanGithubPathPart(owner)}/${cleanGithubPathPart(repo)}`, { headers });
    if (!mr.ok) {
      if (mr.status === 404) {
        if (token) throw new Error(`Repo ${owner}/${repo} not found or not visible to your GitHub account.`);
        throw new Error(`Repo ${owner}/${repo} not found or is private. Connect GitHub first.`);
      }
      const body = await mr.text().catch(() => "");
      throw new Error(`Could not read repo (${mr.status}): ${body.slice(0, 160) || mr.statusText}`);
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

  const strip = subpath ? subpath : "";
  const blobs: RepoTreeBlob[] = tree.tree
    .filter((n: any) => n.type === "blob")
    .filter((n: any) => !strip || n.path.startsWith(strip + "/") || n.path === strip)
    .filter((n: any) => !SKIP_DIR.test("/" + n.path + "/"))
    .filter((n: any) => ALLOWED.test(n.path))
    .filter((n: any) => (n.size ?? 0) < 250_000)
    .slice(0, 600)
    .map((n: any) => ({ path: n.path as string, sha: n.sha as string, size: (n.size ?? 0) as number }));

  if (blobs.length === 0) throw new Error("No importable text files found in this repo or subfolder");
  return { branch: resolvedBranch, blobs, stripPrefix: strip };
}

export async function readGithubBlobBatch({
  owner,
  repo,
  blobs,
  token,
  stripPrefix,
}: {
  owner: string;
  repo: string;
  blobs: { path: string; sha: string }[];
  token?: string;
  stripPrefix?: string;
}): Promise<ImportedFile[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const strip = stripPrefix || "";
  const stripRe = strip ? new RegExp(`^${escapeRegExp(strip)}/?`) : null;
  const out: ImportedFile[] = [];
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
        if (!r.ok) continue;
        const j = await r.json();
        const content =
          j.encoding === "base64"
            ? Buffer.from(j.content, "base64").toString("utf8")
            : String(j.content ?? "");
        const path = stripRe ? b.path.replace(stripRe, "") : b.path;
        if (path) out.push({ path, content });
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}