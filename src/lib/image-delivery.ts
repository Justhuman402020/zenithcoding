import type { ModelRef } from "./ai-providers";

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