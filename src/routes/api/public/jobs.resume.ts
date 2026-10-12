import { createFileRoute } from "@tanstack/react-router";

// Called once a minute by the backend timer. Restarts builds that were cut off
// after the user's device disconnected, continuing from where they stopped.
export const MAX_AUTO_RESUMES = 6;
export const STALE_AFTER_MS = 90_000;

export function shouldResume(job: { status: string; auto_resumes: number; updated_at: string; resume_payload: unknown }, now = Date.now()) {
  if (job.status !== "queued" && job.status !== "running") return false;
  if (!job.resume_payload) return false;
  if (job.auto_resumes >= MAX_AUTO_RESUMES) return false;
  return now - new Date(job.updated_at).getTime() > STALE_AFTER_MS;
}

export const Route = createFileRoute("/api/public/jobs/resume")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-resume-token");
        const { verifyResumeToken } = await import("@/lib/job-resume.server");
        if (!(await verifyResumeToken(token))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
        const { data: candidates } = await (supabaseAdmin as any)
          .from("chat_jobs")
          .select("id,project_id,user_id,request_key,status,progress,auto_resumes,updated_at,resume_payload")
          .in("status", ["queued", "running"])
          .not("resume_payload", "is", null)
          .lt("auto_resumes", MAX_AUTO_RESUMES)
          .lt("updated_at", cutoff)
          .limit(3);
        const origin = new URL(request.url).origin;
        const results: Array<{ id: string; ok: boolean; status?: number }> = [];
        await Promise.all(
          (candidates ?? []).filter((j: any) => shouldResume(j)).map(async (job: any) => {
            // Claim the job so two timers never restart it twice.
            const { data: claimed } = await (supabaseAdmin as any)
              .from("chat_jobs")
              .update({ auto_resumes: job.auto_resumes + 1, resumed_at: new Date().toISOString(), progress: `Restarted by the server (${job.auto_resumes + 1}/${MAX_AUTO_RESUMES})` })
              .eq("id", job.id)
              .eq("auto_resumes", job.auto_resumes)
              .select("id");
            if (!claimed?.length) return;
            const payload = job.resume_payload as { messages: any[]; headers: Record<string, string> };
            const note = job.progress ? ` Last saved progress: ${String(job.progress).slice(0, 600)}` : "";
            const messages = [
              ...(payload.messages ?? []),
              {
                id: `resume-${job.id}-${job.auto_resumes + 1}`,
                role: "user",
                parts: [{ type: "text", text: `Continue exactly where you stopped. Do not redo finished work; check the current files first.${note}` }],
              },
            ];
            try {
              const res = await fetch(`${origin}/api/public/chat`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...(payload.headers ?? {}),
                  "x-mode": "build",
                  "x-project-id": job.project_id,
                  "x-forge-request-key": job.request_key,
                  "x-forge-resume-user": job.user_id,
                  "x-forge-resume-token": token!,
                },
                body: JSON.stringify({ messages }),
              });
              // Read the whole stream so this request stays open until the build ends.
              await res.text().catch(() => "");
              results.push({ id: job.id, ok: res.ok, status: res.status });
            } catch {
              results.push({ id: job.id, ok: false });
            }
          }),
        );
        return Response.json({ resumed: results });
      },
    },
  },
});
