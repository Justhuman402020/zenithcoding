import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminRole } from "./admin-auth.server";

export const scrolltideStatus = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await assertAdminRole(context);
  const { connectionFor } = await import("./runtime-mcp/scrolltide.server");
  const row = await connectionFor(context.userId);
  return { state: row?.state ?? "disconnected", updatedAt: row?.updated_at ?? null };
});
export const connectScrolltide = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ origin: z.string().url() }).parse(v)).handler(async ({ data, context }) => {
  await assertAdminRole(context);
  return (await import("./runtime-mcp/scrolltide.server")).startScrolltide(context.userId, data.origin);
});
export const removeScrolltide = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await assertAdminRole(context);
  await (await import("./runtime-mcp/scrolltide.server")).disconnectScrolltide(context.userId);
  return { ok: true };
});
export const findScrolltideTemplates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ query: z.string().min(1).max(500), cursor: z.string().max(2000).optional() }).parse(v)).handler(async ({ data, context }) => {
  await assertAdminRole(context);
  return (await import("./runtime-mcp/templates.server")).searchTemplates(context.userId, data.query, data.cursor);
});
export const readScrolltideTemplate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ id: z.string().min(1).max(500) }).parse(v)).handler(async ({ data, context }) => {
  await assertAdminRole(context);
  return (await import("./runtime-mcp/templates.server")).fetchTemplate(context.userId, data.id);
});
export const saveScrolltideDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ projectId: z.string().uuid(), templateId: z.string().min(1).max(500), requirements: z.string().max(10000) }).parse(v)).handler(async ({ data, context }) => {
  await assertAdminRole(context);
  const { data: project } = await context.supabase.from("projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).maybeSingle();
  if (!project) throw new Error("Project not available.");
  const template = await (await import("./runtime-mcp/templates.server")).fetchTemplate(context.userId, data.templateId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin.from("scrolltide_drafts").insert({ project_id: data.projectId, user_id: context.userId, template_id: data.templateId, title: template.title, source: template.source, brief: template.brief, requirements: data.requirements }).select("id,title,brief,requirements,source,state").single();
  if (error || !row) throw new Error("Could not save the template draft.");
  await supabaseAdmin.from("chat_messages").insert({ project_id: data.projectId, user_id: context.userId, role: "assistant", content: `Scrolltide draft saved: ${template.title}\n${template.source}\nAwaiting approval.\n<!-- worklog -->\n- Template instructions retrieved and saved; no project files changed.` });
  return row;
});
export const decideScrolltideDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v: unknown) => z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(v)).handler(async ({ data, context }) => {
  await assertAdminRole(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin.from("scrolltide_drafts").update({ state: data.approve ? "approved" : "denied" }).eq("id", data.id).eq("user_id", context.userId).eq("state", "draft").select("id").maybeSingle();
  if (error || !row) throw new Error("This draft was already decided or is not available.");
  const { data: draft } = await supabaseAdmin.from("scrolltide_drafts").select("project_id,title").eq("id", row.id).single();
  if (draft) await supabaseAdmin.from("chat_messages").insert({ project_id: draft.project_id, user_id: context.userId, role: "assistant", content: `${data.approve ? "Approved" : "Denied"}: ${draft.title}\n\n<!-- worklog -->\n- ${new Date().toISOString().slice(11, 19)} UTC · Template ${data.approve ? "approved for build" : "denied; no files changed"}` });
  return { id: row.id, approved: data.approve };
});