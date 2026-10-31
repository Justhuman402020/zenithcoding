import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseWorkLog, safeLogText, sanitizeDetail, type WorkStep, type FileEvidence } from "./work-log";

export const getWorkDetails = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ projectId: z.string().uuid(), runId: z.string().max(100), chatId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: project, error: projectError } = await db.from("projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).maybeSingle();
    if (projectError || !project) throw new Error("Work log not available.");
    const [kind, ...rest] = data.runId.split("-");
    const id = rest.join("-");
    let job: any = null;
    let message: any = null;
    let edit: any = null;
    if (data.chatId) {
      const { data: chat } = await db.from("assistant_chats").select("id").eq("id", data.chatId).eq("user_id", context.userId).maybeSingle();
      if (!chat) throw new Error("Chat not available.");
    }
    if (kind === "e") {
      const { data: row, error } = await db.from("assistant_edit_requests").select("*").eq("id", id).eq("project_id", data.projectId).eq("user_id", context.userId).maybeSingle();
      if (error || !row || row.chat_id !== data.chatId) throw new Error("Work log not available.");
      edit = row;
    }
    if (kind === "m" || kind === "a") {
      let q = db.from(kind === "a" ? "assistant_messages" : "chat_messages").select(kind === "a" ? "id,content,parts,created_at" : "id,content,created_at").eq("id", id).eq("user_id", context.userId);
      q = kind === "a" ? q.eq("chat_id", data.chatId) : q.eq("project_id", data.projectId);
      const { data: row, error } = await q.maybeSingle();
      if (error || !row) throw new Error("Work log not available.");
      message = row;
    }
    if (kind === "a" && message?.parts?.editId) {
      const { data: row } = await db.from("assistant_edit_requests").select("*").eq("id", message.parts.editId).eq("project_id", data.projectId).eq("chat_id", data.chatId).eq("user_id", context.userId).maybeSingle();
      edit = row;
    }
    const linkedId = message?.content?.match(/<!-- run:([\w-]+) -->/)?.[1];
    if (kind === "j" || kind === "k" || edit?.request_key || linkedId) {
      let q = db.from("chat_jobs").select("id,prompt,status,progress,error,outcome,steps_done,files_changed,created_at,completed_at,trace_id").eq("project_id", data.projectId).eq("user_id", context.userId);
      q = q.eq(kind === "k" || edit?.request_key ? "request_key" : "id", edit?.request_key ?? linkedId ?? id);
      const { data: row, error } = await q.maybeSingle();
      if (error) throw new Error("Could not load this work log.");
      job = row;
    }
    let events: any[] = [];
    if (job?.trace_id) {
      const { data: rows, error } = await db.from("chat_traces").select("id,phase,status,message,detail,duration_ms,created_at,seq").eq("project_id", data.projectId).eq("user_id", context.userId).eq("trace_id", job.trace_id).order("created_at").order("seq").limit(2000);
      if (error) throw new Error("Could not load recorded steps.");
      events = rows ?? [];
    }
    const legacy = parseWorkLog(message?.content?.split("\n\n<!-- worklog -->\n")[1] ?? (message?.parts?.log ?? edit?.report?.log ?? []).join("\n"));
    const steps: WorkStep[] = events.filter(t => t.phase !== "file.change" && !/^(request\.|credits\.|project\.|snapshot\.)/.test(t.phase)).map(t => ({
      time: String(t.created_at).slice(11, 19), text: safeLogText(t.phase === "work.progress" ? t.message ?? "Working" : `${t.phase.replace(/^tool\./, "").replace(/[._]/g, " ")}${t.detail?.path ? ` · ${t.detail.path}` : ""}${t.message ? ` — ${t.message}` : ""}`),
      status: String(t.status), durationMs: t.duration_ms == null ? null : Number(t.duration_ms), detail: JSON.stringify(sanitizeDetail(t.detail)),
    }));
    const changes = events.filter(t => t.phase === "file.change" && t.detail?.change).map(t => sanitizeDetail(t.detail.change) as FileEvidence);
    const files = [...new Set<string>([...legacy.files, ...changes.map(c => c.path)])];
    return { title: safeLogText(job?.prompt ?? edit?.prompt ?? "Work log"), status: String(job?.status ?? edit?.status ?? (kind === "k" ? "queued" : "completed")), progress: safeLogText(job?.progress ?? ""), error: safeLogText(job?.error ?? ""), startedAt: job?.created_at ?? edit?.created_at ?? null, completedAt: job?.completed_at ?? null, steps: steps.length ? steps : legacy.steps, changes, files, stepCount: Number(job?.steps_done ?? steps.length), fileCount: Number(job?.files_changed ?? files.length) };
  });