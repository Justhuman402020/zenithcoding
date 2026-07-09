import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type Evt =
  | { type: "log"; level: "info" | "warn" | "error" | "success"; message: string; meta?: unknown }
  | { type: "progress"; phase: string; current: number; total: number }
  | { type: "blob"; path: string; sha: string }
  | { type: "result"; sha: string; branch: string; url: string; fileCount: number }
  | { type: "error"; message: string };

function cleanGithubPathPart(value: string) {
  return encodeURIComponent(value.trim()).replace(/%2F/g, "/");
}

export const Route = createFileRoute("/api/public/push-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });

        let body: {
          projectId?: string;
          branch?: string;
          message?: string;
          createBranch?: boolean;
          fromBranch?: string;
          priorBlobs?: { path: string; sha: string }[];
          extraFiles?: { path: string; content: string }[];
        };
        try {
          body = await request.json();
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const projectId = String(body.projectId || "");
        const branch = String(body.branch || "").trim();
        const message = String(body.message || "").trim();
        const createBranch = Boolean(body.createBranch);
        const fromBranchInput = body.fromBranch ? String(body.fromBranch).trim() : "";
        const priorBlobs = Array.isArray(body.priorBlobs) ? body.priorBlobs : [];
        const extraFiles = Array.isArray(body.extraFiles) ? body.extraFiles : [];
        const priorMap = new Map<string, string>();
        for (const b of priorBlobs) {
          if (b && typeof b.path === "string" && typeof b.sha === "string") {
            priorMap.set(b.path, b.sha);
          }
        }
        if (!projectId) return new Response("Missing projectId", { status: 400 });
        if (!branch) return new Response("Missing branch", { status: 400 });
        if (!/^[\w.\-\/]+$/.test(branch)) return new Response("Invalid branch name", { status: 400 });
        if (!message) return new Response("Missing commit message", { status: 400 });

        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (evt: Evt) => {
              try {
                controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
              } catch {}
            };
            const log = (
              level: "info" | "warn" | "error" | "success",
              msg: string,
              meta?: unknown,
            ) => send({ type: "log", level, message: msg, meta });

            try {
              log("info", "Looking up GitHub link for this project…");
              const { data: link } = await supabase
                .from("project_github_links" as any)
                .select("owner, repo, default_branch")
                .eq("project_id", projectId)
                .eq("user_id", userId)
                .maybeSingle();
              if (!link) throw new Error("This project is not linked to a GitHub repository.");
              const l = link as any;
              log("info", `Linked repo: ${l.owner}/${l.repo} (default: ${l.default_branch})`);

              const { data: tok } = await supabase
                .from("github_tokens" as any)
                .select("access_token")
                .eq("user_id", userId)
                .maybeSingle();
              if (!tok) throw new Error("Connect GitHub first");
              const ghToken = (tok as any).access_token as string;

              log("info", "Loading project files…");
              const { data: filesRows, error: filesErr } = await supabase
                .from("files" as any)
                .select("path, content")
                .eq("project_id", projectId)
                .eq("user_id", userId)
                .eq("kind", "source");
              if (filesErr) throw new Error(filesErr.message);
              const sourceFiles = (filesRows || []) as unknown as { path: string; content: string }[];
              // Merge extraFiles (built dist) — extras override sources at same path.
              const merged = new Map<string, string>();
              for (const f of sourceFiles) merged.set(f.path, f.content);
              for (const f of extraFiles) merged.set(f.path, f.content);
              const files: { path: string; content: string }[] = Array.from(
                merged,
                ([path, content]) => ({ path, content }),
              );
              if (extraFiles.length) {
                log("info", `Including ${extraFiles.length} built artifact(s) in commit`);
              }
              if (files.length === 0) throw new Error("No files to push");
              if (files.length > 800)
                throw new Error("Too many files to push in one commit (max 800)");
              log("success", `Loaded ${files.length} files`);
              const filesToUpload = files.filter((f) => !priorMap.has(f.path));
              if (priorMap.size > 0) {
                log(
                  "info",
                  `Resuming: ${priorMap.size} blob(s) already uploaded, ${filesToUpload.length} remaining`,
                );
              }

              const owner = cleanGithubPathPart(l.owner);
              const repo = cleanGithubPathPart(l.repo);
              const base = `https://api.github.com/repos/${owner}/${repo}`;
              const headers: Record<string, string> = {
                Authorization: `Bearer ${ghToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
              };
              async function gh<T = any>(path: string, init?: RequestInit): Promise<T> {
                const r = await fetch(`${base}${path}`, {
                  ...init,
                  headers: { ...headers, ...(init?.headers || {}) },
                });
                if (!r.ok) {
                  const body = await r.text().catch(() => "");
                  throw new Error(
                    `GitHub ${r.status} on ${path}: ${body.slice(0, 240) || r.statusText}`,
                  );
                }
                return r.json() as Promise<T>;
              }

              log("info", `Resolving branch "${branch}"…`);
              let refSha: string | null = null;
              const refRes = await fetch(`${base}/git/ref/heads/${cleanGithubPathPart(branch)}`, {
                headers,
              });
              if (refRes.ok) {
                refSha = (await refRes.json()).object?.sha ?? null;
                log("success", `Branch "${branch}" exists at ${String(refSha).slice(0, 7)}`);
              } else if (refRes.status === 404) {
                if (!createBranch)
                  throw new Error(
                    `Branch "${branch}" does not exist on GitHub. Enable "Create new branch" to add it.`,
                  );
                const sourceBranch = (fromBranchInput || l.default_branch || "main").trim();
                log("info", `Creating "${branch}" from "${sourceBranch}"…`);
                const sourceRef = await gh<any>(
                  `/git/ref/heads/${cleanGithubPathPart(sourceBranch)}`,
                );
                const sourceSha = sourceRef.object?.sha as string;
                await gh(`/git/refs`, {
                  method: "POST",
                  body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: sourceSha }),
                });
                refSha = sourceSha;
                log("success", `Created "${branch}" at ${sourceSha.slice(0, 7)}`);
              } else {
                const bodyText = await refRes.text().catch(() => "");
                throw new Error(
                  `GitHub ${refRes.status}: ${bodyText.slice(0, 240) || refRes.statusText}`,
                );
              }
              if (!refSha) throw new Error("Could not resolve base commit");

              const baseCommit = await gh<any>(`/git/commits/${refSha}`);
              const baseTreeSha = baseCommit.tree?.sha as string;
              log("info", `Base tree ${String(baseTreeSha).slice(0, 7)}`);

              log("info", `Uploading ${filesToUpload.length} blob(s) to GitHub…`);
              send({ type: "progress", phase: "blobs", current: 0, total: filesToUpload.length });
              const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
              // Seed tree entries with previously uploaded blobs.
              for (const [path, sha] of priorMap.entries()) {
                treeEntries.push({ path, mode: "100644", type: "blob", sha });
              }
              let idx = 0;
              let done = 0;
              const errors: string[] = [];
              async function blobWorker() {
                while (idx < filesToUpload.length) {
                  const i = idx++;
                  const f = filesToUpload[i];
                  try {
                    const b = await gh<any>(`/git/blobs`, {
                      method: "POST",
                      body: JSON.stringify({
                        content: Buffer.from(f.content, "utf8").toString("base64"),
                        encoding: "base64",
                      }),
                    });
                    treeEntries.push({
                      path: f.path,
                      mode: "100644",
                      type: "blob",
                      sha: b.sha,
                    });
                    send({ type: "blob", path: f.path, sha: b.sha });
                  } catch (e: any) {
                    errors.push(`${f.path}: ${e?.message || "blob failed"}`);
                    log("error", `Blob failed for ${f.path}: ${e?.message || "unknown"}`);
                  } finally {
                    done++;
                    if (done % 5 === 0 || done === filesToUpload.length) {
                      send({
                        type: "progress",
                        phase: "blobs",
                        current: done,
                        total: filesToUpload.length,
                      });
                    }
                  }
                }
              }
              await Promise.all(Array.from({ length: 6 }, blobWorker));
              if (errors.length > 0) {
                throw new Error(
                  `${errors.length} blob upload(s) failed. Retry to resume from where it stopped. First error: ${errors[0]}`,
                );
              }
              if (treeEntries.length === 0)
                throw new Error("No blobs to commit");
              log(
                errors.length ? "warn" : "success",
                `Uploaded ${treeEntries.length}/${files.length} blob(s)${
                  errors.length ? ` (${errors.length} failed)` : ""
                }`,
              );

              log("info", "Creating tree…");
              const newTree = await gh<any>(`/git/trees`, {
                method: "POST",
                body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
              });
              log("success", `Tree ${String(newTree.sha).slice(0, 7)} created`);

              log("info", "Creating commit…");
              const commit = await gh<any>(`/git/commits`, {
                method: "POST",
                body: JSON.stringify({
                  message,
                  tree: newTree.sha,
                  parents: [refSha],
                }),
              });
              log("success", `Commit ${String(commit.sha).slice(0, 7)} created`);

              log("info", `Updating ref refs/heads/${branch}…`);
              await gh(`/git/refs/heads/${cleanGithubPathPart(branch)}`, {
                method: "PATCH",
                body: JSON.stringify({ sha: commit.sha, force: false }),
              });
              log("success", `Pushed to ${l.owner}/${l.repo}@${branch}`);

              await supabase
                .from("project_github_links" as any)
                .update({
                  last_pushed_branch: branch,
                  last_pushed_sha: commit.sha,
                  last_pushed_message: message,
                  last_pushed_at: new Date().toISOString(),
                })
                .eq("project_id", projectId)
                .eq("user_id", userId);

              send({
                type: "result",
                sha: commit.sha,
                branch,
                url: `https://github.com/${l.owner}/${l.repo}/commit/${commit.sha}`,
                fileCount: treeEntries.length,
              });
            } catch (e: any) {
              const msg = e?.message || "Push failed";
              log("error", msg);
              send({ type: "error", message: msg });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
