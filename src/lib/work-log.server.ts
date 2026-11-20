import type { ProjectFileStore } from "./chat-tools.server";
import type { TraceLogger } from "./trace.server";
import { fileEvidence } from "./work-log";

/** All mutation tools, including integrations and Brain copies, share this store. */
export function withWorkEvidence(store: ProjectFileStore, trace: TraceLogger): ProjectFileStore {
  async function record(path: string, before: string | null | undefined, after: string | null) {
    trace.log("file.change", { detail: { path, change: fileEvidence(path, before, after) } });
    await trace.flush();
  }
  return {
    list: store.list,
    read: store.read,
    async write(path, content) {
      const old = await store.read(path);
      const before = old.content ?? (old.error === "not found" ? null : undefined);
      const result = await store.write(path, content);
      if (result.ok) await record(path, before, content);
      return result;
    },
    async remove(path) {
      const old = await store.read(path);
      const result = await store.remove(path);
      if (result.ok) await record(path, old.content, null);
      return result;
    },
  };
}
