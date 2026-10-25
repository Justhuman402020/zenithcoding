import type { ModelRef } from "./ai-providers";

export type EditorBuildMode = "plan" | "build" | "image";
export function editorRequestChoice(mode: EditorBuildMode, hasImages: boolean) {
  return {
    mode: mode === "plan" ? "plan" as const : "build" as const,
    engine: mode === "image" || (mode === "build" && hasImages) ? "openrouter" as const : "cloudflare" as const,
    imageBuild: mode === "image" || (mode === "build" && hasImages),
  };
}

export function attachedImageUrls(messages: Array<{ role: string; parts?: unknown[] }>) {
  const latest = [...messages].reverse().find((m) => m.role === "user");
  return (latest?.parts ?? []).flatMap((part) => {
    const p = part as Record<string, any>;
    const mime = p.mediaType ?? p.mimeType;
    if (p.type !== "image" && !(p.type === "file" && typeof mime === "string" && mime.startsWith("image/"))) return [];
    const url = p.url ?? p.image ?? p.data;
    return typeof url === "string" && url.length ? [url] : [];
  });
}

export function imageReaderRef(snapshot: ModelRef | null, selected: ModelRef | null, fallback: ModelRef | null) {
  return snapshot ?? selected ?? fallback;
}