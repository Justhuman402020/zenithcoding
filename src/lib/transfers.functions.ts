import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const initiateTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; toEmail: string }) =>
    z.object({ projectId: z.string().uuid(), toEmail: z.string().email() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id,name,user_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr || !project) throw new Error("Project not found");
    if (project.user_id !== userId) throw new Error("Only the owner can transfer this project");

    const { data: existing } = await supabase
      .from("project_transfers")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) throw new Error("A transfer is already pending for this project. Cancel it first.");

    const { data: row, error } = await supabase
      .from("project_transfers")
      .insert({ project_id: data.projectId, from_user_id: userId, to_email: data.toEmail.toLowerCase() })
      .select("id,token,to_email,expires_at,status")
      .single();
    if (error) throw new Error(error.message);

    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const origin = req?.headers.get("origin") ?? new URL(req?.url ?? "http://localhost").origin;
    const acceptUrl = `${origin}/transfers/${row.token}`;
    return { ...row, acceptUrl, projectName: project.name };
  });

export const listMyTransfers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("project_transfers")
      .select("id,token,to_email,status,created_at,expires_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

export const cancelTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { transferId: string }) => z.object({ transferId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_transfers")
      .update({ status: "cancelled" })
      .eq("id", data.transferId)
      .eq("from_user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Look up transfer by token (no auth — anyone with the link can see the invitation preview)
export const getTransferByToken = createServerFn({ method: "GET" })
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("project_transfers")
      .select("id,project_id,to_email,status,expires_at,from_user_id,projects:project_id(name)")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: (row.projects as { name?: string } | null)?.name ?? "Untitled project",
      toEmail: row.to_email,
      status: row.status,
      expiresAt: row.expires_at,
    };
  });

export const acceptTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("project_transfers")
      .select("id,project_id,to_email,status,expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) throw new Error("Transfer link is invalid.");
    if (row.status !== "pending") throw new Error(`This transfer is already ${row.status}.`);
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("This transfer has expired.");

    const email = (context.claims.email as string | undefined)?.toLowerCase();
    if (!email || email !== row.to_email.toLowerCase()) {
      throw new Error(`This transfer was sent to ${row.to_email}. Sign in with that email to accept.`);
    }

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id")
      .eq("owner_user_id", context.userId)
      .eq("personal", true)
      .maybeSingle();

    const { error: upErr } = await supabaseAdmin
      .from("projects")
      .update({ user_id: context.userId, workspace_id: ws?.id ?? null })
      .eq("id", row.project_id);
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin
      .from("project_transfers")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by_user_id: context.userId })
      .eq("id", row.id);

    return { ok: true, projectId: row.project_id };
  });