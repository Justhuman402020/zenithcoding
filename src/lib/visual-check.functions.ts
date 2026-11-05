import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";

/** Explicit user action: queues a read-only screenshot inspection on the durable job connection. */
export const startVisualCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ projectId: z.string().uuid(), html: z.string().min(1).max(12000000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("workspace_session_allowed");
    if (!allowed) throw new Error("Not available");
    const { data: project } = await context.supabase.from("projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).maybeSingle();
    if (!project) throw new Error("Project not available");
    const origin = new URL(getRequest().url).origin;
    if (["localhost", "127.0.0.1", "::1"].includes(new URL(origin).hostname)) throw new Error("Publish this update and start screenshot inspection from your live Code Haven site; the remote browser cannot reach this local editor.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { readWorkspaceAI } = await import("./workspace-ai.server");
    const selected = (await readWorkspaceAI()).image;
    if (!selected) throw new Error("Choose your OpenRouter image reader in AI Models first.");
    const requestKey = crypto.randomUUID();
    const prompt = "[Visual check only] Take screenshots and inspect this preview. Do not edit files or publish. Return the visible problems and await approval for repairs.";
    const messages = [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] }];
    const { data: job, error } = await db.from("chat_jobs").insert({ project_id: data.projectId, user_id: context.userId, request_key: requestKey, status: "queued", prompt, visual_reader_provider: selected.provider, visual_reader_model: selected.model,
      resume_payload: { messages, headers: { "x-forge-mode": "build", "x-forge-visual-only": "yes" }, visualHtml: data.html } }).select("id").single();
    if (error || !job) throw new Error("Could not save visual-check request.");
    const { error: dispatchError } = await db.rpc("dispatch_saved_build", { _job: job.id });
    if (dispatchError) {
      await db.from("chat_jobs").update({ status: "failed", error: "Could not start screenshot check", outcome: "failed" }).eq("id", job.id);
      throw new Error("Could not start screenshot inspection. Your files are unchanged.");
    }
    return { jobId: job.id, requestKey };
  });