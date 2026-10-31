import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { BRAIN_ZIP_BUCKET, MAX_BRAIN_ZIP_BYTES, inspectBrainZip } from "./brain-zip";

export const getBrainZips = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { listBrainZips } = await import("./brain-zip.server");
    return listBrainZips(context.supabase, data.projectId);
  });

export const saveBrainZip = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ projectId: z.string().uuid(), name: z.string().min(1).max(200), storagePath: z.string().max(500), byteSize: z.number().positive().max(MAX_BRAIN_ZIP_BYTES) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.storagePath.startsWith(`${context.userId}/${data.projectId}/`)) throw new Error("Invalid project reference path.");
    const { data: project } = await context.supabase.from("projects").select("id").eq("id", data.projectId).eq("user_id", context.userId).maybeSingle();
    if (!project) throw new Error("Project not available.");
    const { data: blob, error } = await context.supabase.storage.from(BRAIN_ZIP_BUCKET).download(data.storagePath);
    if (error || !blob) throw new Error("Upload did not finish. Try again.");
    const files = await inspectBrainZip(new Uint8Array(await blob.arrayBuffer()), data.name);
    const { error: savedError } = await context.supabase.from("project_brain_zips").insert({ project_id: data.projectId, user_id: context.userId, name: data.name, storage_path: data.storagePath, byte_size: blob.size, manifest: files.map(f => ({ path: f.path, media: f.content.startsWith("data:") })) });
    if (savedError) throw new Error(savedError.message);
    return { ok: true };
  });

export const removeBrainZip = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ projectId: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase.from("project_brain_zips").select("storage_path").eq("project_id", data.projectId).eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!row) throw new Error("ZIP not found.");
    const { error } = await context.supabase.storage.from(BRAIN_ZIP_BUCKET).remove([row.storage_path]);
    if (error) throw new Error(error.message);
    const { error: deletedError } = await context.supabase.from("project_brain_zips").delete().eq("id", data.id).eq("project_id", data.projectId);
    if (deletedError) throw new Error(deletedError.message);
    return { ok: true };
  });