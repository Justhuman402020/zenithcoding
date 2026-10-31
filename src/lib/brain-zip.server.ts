import { tool } from "ai";
import { z } from "zod";
import { BRAIN_ZIP_BUCKET, inspectBrainZip, referenceFileContent, type BrainZip } from "./brain-zip";
import type { ProjectFileStore } from "./chat-tools.server";
import type { TraceLogger } from "./trace.server";

export async function listBrainZips(client: any, projectId: string): Promise<BrainZip[]> {
  const { data, error } = await client.from("project_brain_zips").select("id,name,byte_size,manifest,created_at").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadBrainZip(client: any, projectId: string, id: string) {
  const { data: row, error } = await client.from("project_brain_zips").select("name,storage_path").eq("project_id", projectId).eq("id", id).maybeSingle();
  if (error || !row) throw new Error("ZIP not found in this project's Brain.");
  const { data, error: downloadError } = await client.storage.from(BRAIN_ZIP_BUCKET).download(row.storage_path);
  if (downloadError || !data) throw new Error("Could not read the saved ZIP. Try again.");
  return inspectBrainZip(new Uint8Array(await data.arrayBuffer()), row.name);
}

export function createBrainZipTools(client: any, projectId: string, store: ProjectFileStore, trace?: TraceLogger) {
  const cache = new Map<string, Awaited<ReturnType<typeof loadBrainZip>>>();
  const load = async (id: string) => {
    const existing = cache.get(id);
    if (existing) return existing;
    const files = await loadBrainZip(client, projectId, id);
    cache.set(id, files);
    return files;
  };
  const readTools = {
    list_brain_zips: tool({ description: "List saved ZIP references in this project's Brain only.", inputSchema: z.object({}), execute: () => listBrainZips(client, projectId) }),
    list_brain_zip_files: tool({ description: "List every usable file in a project Brain ZIP, including media.", inputSchema: z.object({ referenceId: z.string().uuid() }), execute: async ({ referenceId }) => (await load(referenceId)).map(f => ({ path: f.path, media: f.content.startsWith("data:"), characters: f.content.length })) }),
    read_brain_zip_file: tool({ description: "Read reference source with pagination. Secrets are hidden. For original media use copy_brain_zip_file during an approved build.", inputSchema: z.object({ referenceId: z.string().uuid(), path: z.string(), offset: z.number().int().min(0).default(0) }), execute: async ({ referenceId, path, offset }) => {
      const file = (await load(referenceId)).find(f => f.path === path);
      if (!file) return { error: "File not found" };
      if (file.content.startsWith("data:")) return { media: true, path, instruction: "Use copy_brain_zip_file to retain these original bytes." };
      const content = referenceFileContent(path, file.content);
      return { path, content: content.slice(offset, offset + 16000), nextOffset: offset + 16000 < content.length ? offset + 16000 : null };
    } }),
  };
  return { readTools, copy_brain_zip_file: tool({
    description: "Copy original reference media/source into a NEW project path. Never overwrites current files or copies credentials. Adapt existing pages with normal editing tools to preserve navigation.",
    inputSchema: z.object({ referenceId: z.string().uuid(), path: z.string(), destination: z.string().regex(/^(?!\/)(?!.*\.\.)(?!.*\\)[\w./@ -]+$/) }),
    execute: async ({ referenceId, path, destination }) => {
      const file = (await load(referenceId)).find(f => f.path === path);
      if (!file) return { error: "File not found" };
      if (referenceFileContent(path, file.content) !== file.content) return { error: "Credential files cannot be copied by the agent." };
      if ((await store.list()).includes(destination)) return { error: "Destination exists. Read and edit the current file to preserve navigation; choose a new path for reference assets." };
      const result = await store.write(destination, file.content);
      trace?.log("tool.copy_brain_zip_file", { status: result.ok ? "ok" : "error", detail: { path: destination, referenceId } });
      return result;
    },
  }) };
}