import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TEMPLATE_CATEGORIES = {
  all: "",
  landing: "topic:landing-page",
  dashboard: "topic:dashboard",
  saas: "topic:saas",
  portfolio: "topic:portfolio",
  ecommerce: "topic:ecommerce",
} as const;
type Category = keyof typeof TEMPLATE_CATEGORIES;

export type GithubTemplate = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  avatar: string;
  description: string | null;
  stars: number;
  language: string | null;
  category: string;
  url: string;
  branch: string;
};

// Server-side cache: same search within 5 minutes never hits GitHub again.
const cache = new Map<string, { at: number; value: { items: GithubTemplate[]; total: number } }>();
const CACHE_MS = 5 * 60_000;

function categoryFromTopics(topics: string[]): string {
  if (topics.includes("landing-page")) return "Landing Page";
  if (topics.includes("dashboard") || topics.includes("admin-dashboard")) return "Dashboard";
  if (topics.includes("saas")) return "SaaS";
  if (topics.includes("portfolio")) return "Portfolio";
  if (topics.includes("ecommerce") || topics.includes("e-commerce")) return "E-Commerce";
  return "Starter";
}

export const searchGithubTemplates = createServerFn({ method: "GET" })
  .inputValidator((d: { category?: string; query?: string; page?: number }) =>
    z
      .object({
        category: z.enum(["all", "landing", "dashboard", "saas", "portfolio", "ecommerce"]).default("all"),
        query: z.string().max(100).default(""),
        page: z.number().int().min(1).max(5).default(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const topic = TEMPLATE_CATEGORIES[data.category as Category];
    const words = data.query.replace(/[^\w\s-]/g, " ").trim();
    const q = ["is:template", topic || (words ? "" : "topic:starter-template"), words].filter(Boolean).join(" ");
    const key = `${q}|${data.page}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true as const, ...hit.value };

    const { getIntegrationKey } = await import("./integration-keys.server");
    const token = (await getIntegrationKey("github", "token")) ?? process.env.GITHUB_MODELS_TOKEN ?? "";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "code-haven",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${data.page}`;
    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
      if (hit) return { ok: true as const, ...hit.value };
      return {
        ok: false as const,
        rateLimited: true,
        message: "GitHub is taking a short breather (30 searches per minute). Please wait a minute and try again.",
        items: [] as GithubTemplate[],
        total: 0,
      };
    }
    if (!res.ok) {
      return { ok: false as const, rateLimited: false, message: `GitHub search failed (${res.status}).`, items: [] as GithubTemplate[], total: 0 };
    }
    const j = (await res.json()) as any;
    const items: GithubTemplate[] = ((j.items ?? []) as any[]).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner?.login ?? "",
      avatar: r.owner?.avatar_url ?? "",
      description: r.description ?? null,
      stars: r.stargazers_count ?? 0,
      language: r.language ?? null,
      category: categoryFromTopics(r.topics ?? []),
      url: r.html_url,
      branch: r.default_branch ?? "main",
    }));
    const value = { items, total: Math.min(j.total_count ?? 0, 500) };
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return { ok: true as const, ...value };
  });

export const remixGithubTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fullName: string; branch?: string; description?: string | null }) =>
    z
      .object({
        fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
        branch: z.string().max(200).optional(),
        description: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [owner, repo] = data.fullName.split("/") as [string, string];
    const { getIntegrationKey } = await import("./integration-keys.server");
    const { readGithubRepoFiles } = await import("./github-import.server");
    const token = (await getIntegrationKey("github", "token")) ?? undefined;
    const { files } = await readGithubRepoFiles({ owner, repo, branch: data.branch, token });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("personal", true)
      .maybeSingle();
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, name: repo, description: data.description ?? `Remixed from ${data.fullName}`, workspace_id: ws?.id ?? null })
      .select("id")
      .single();
    if (error || !project) throw new Error(error?.message ?? "Failed to create project");

    const rows = files.map((f) => ({ project_id: project.id, user_id: userId, path: f.path, content: f.content }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error: fErr } = await supabase.from("files").insert(rows.slice(i, i + 100));
      if (fErr) throw new Error(fErr.message);
    }
    const { seedPlatformBackend } = await import("./platform-backend.server");
    await seedPlatformBackend(project.id, userId);
    return { projectId: project.id, files: rows.length };
  });
