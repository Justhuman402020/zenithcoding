import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(18)));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(36).padStart(2, "0");
  return s.slice(0, 28);
}

export const listShareLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("share_links")
      .select("id, token, label, expires_at, revoked, view_count, created_at")
      .eq("project_id", data.projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { links: rows ?? [] };
  });

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; label?: string; days?: number }) =>
    z.object({
      projectId: z.string().uuid(),
      label: z.string().max(80).optional(),
      days: z.number().int().min(1).max(30).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects").select("id").eq("id", data.projectId).eq("user_id", userId).maybeSingle();
    if (!project) throw new Error("Project not found");
    const token = makeToken();
    const expires = new Date(Date.now() + (data.days ?? 7) * 24 * 60 * 60 * 1000).toISOString();
    const { data: row, error } = await supabase
      .from("share_links")
      .insert({
        project_id: data.projectId,
        user_id: userId,
        token,
        label: data.label ?? null,
        expires_at: expires,
      })
      .select("id, token, label, expires_at, revoked, view_count, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { link: row };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("share_links").update({ revoked: true }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });