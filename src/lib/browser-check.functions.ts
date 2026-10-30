import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  projectId: z.string().uuid(),
  target: z.enum(["preview", "published"]),
  html: z.string().max(12_000_000).optional(),
});

/** Opens the project in a real browser (Cloudflare Browser Rendering) and saves what it found. */
export const runBrowserCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("workspace_session_allowed");
    if (!allowed) throw new Error("Not available");
    const { data: project } = await context.supabase.from("projects").select("id, slug, published").eq("id", data.projectId).maybeSingle();
    if (!project) throw new Error("Project not found");
    const origin = new URL(getRequest().url).origin;
    const { createPreviewToken, runCheck } = await import("./browser-check.server");
    let url: string;
    if (data.target === "published") {
      if (!(project as any).published || !(project as any).slug) throw new Error("This project isn't published yet.");
      url = `${origin}/s/${(project as any).slug}`;
    } else {
      if (!data.html) throw new Error("Nothing to test yet.");
      url = `${origin}/api/public/preview/${await createPreviewToken(context.userId, data.projectId, data.html)}`;
    }
    const started = Date.now();
    const out = await runCheck({ userId: context.userId, projectId: data.projectId, url, published: data.target === "published" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordModelCall } = await import("./workspace-ai.server");
    await recordModelCall({ user_id: context.userId, project_id: data.projectId, provider: "cloudflare", model: "Browser Rendering", section: "browser_test", started_at: started, status: out.ok ? "ok" : "failed", error: out.ok ? null : out.error });
    const { data: row } = await supabaseAdmin.from("browser_checks" as any).insert({
      user_id: context.userId, project_id: data.projectId, target: data.target, ok: out.ok,
      findings: out.ok ? out.findings : {}, screenshots: out.ok ? out.shots : [],
      duration_ms: out.durationMs, error_short: out.ok ? null : out.error.slice(0, 200),
    } as any).select("id").single();
    return { id: (row as any)?.id as string, ...(await withSignedShots(out)) };
  });

async function withSignedShots(out: Awaited<ReturnType<typeof import("./browser-check.server").runCheck>>) {
  if (!out.ok) return { ok: false as const, error: out.error, missingPermission: out.missingPermission, durationMs: out.durationMs };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const shots = await Promise.all(out.shots.map(async (s) => {
    const { data } = await supabaseAdmin.storage.from("browser-checks").createSignedUrl(s.url, 3600);
    return { label: s.label, url: data?.signedUrl ?? "" };
  }));
  return { ok: true as const, findings: out.findings, shots, durationMs: out.durationMs, missingPermission: out.missingPermission };
}

/** Latest saved test for a project, with fresh screenshot links. */
export const latestBrowserCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any).from("browser_checks").select("*").eq("project_id", data.projectId).eq("ok", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shots = await Promise.all(((row.screenshots ?? []) as { label: string; url: string }[]).map(async (s) => {
      const { data: d } = await supabaseAdmin.storage.from("browser-checks").createSignedUrl(s.url, 3600);
      return { label: s.label, url: d?.signedUrl ?? "" };
    }));
    return { id: row.id as string, createdAt: row.created_at as string, target: row.target as string, findings: row.findings, shots, durationMs: row.duration_ms as number };
  });
