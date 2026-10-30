import { parseHTML } from "linkedom";
import { mcpFetch } from "./fetch.server";

export type CatalogItem = { id: string; title: string; description: string; source: string; preview: string | null; poster?: string | null };
export const LIBRARY_SHELVES = ["templates", "components", "sections", "ui", "shaders"] as const;
function https(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { const u = new URL(value, "https://www.scrolltide.co"); return u.protocol === "https:" ? u.href : null; } catch { return null; }
}
export function parseCatalog(html: string, shelf: string): CatalogItem[] {
  const { document } = parseHTML(html);
  const items: CatalogItem[] = [];
  const posters = new Map<string, string>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const media = https(row.previewVideo); const poster = https(row.posterImage);
    if (media && poster) posters.set(media, poster);
    Object.values(row).forEach(collect);
  };
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent ?? "";
    if (!text.startsWith("self.__next_f.push(")) continue;
    try {
      const entry = JSON.parse(text.slice("self.__next_f.push(".length).replace(/\);?\s*$/, ""));
      if (typeof entry[1] !== "string") continue;
      for (const line of entry[1].split("\n")) { const i = line.indexOf(":"); if (i < 0) continue; try { collect(JSON.parse(line.slice(i + 1))); } catch { /* Non-JSON stream record. */ } }
    } catch { /* Never execute page scripts. */ }
  }
  if (shelf === "templates") {
    for (const a of document.querySelectorAll('a[href^="/templates/"]')) {
      const id = a.getAttribute("href")?.split("/")[2]; const title = a.querySelector("h3")?.textContent?.trim();
      if (!id || !title) continue;
      const paragraphs = a.querySelectorAll("p");
      items.push({ id, title, description: paragraphs[paragraphs.length - 1]?.textContent?.trim() ?? "", source: `https://www.scrolltide.co/templates/${encodeURIComponent(id)}`, preview: https(a.querySelector("video source")?.getAttribute("src") ?? a.querySelector("img")?.getAttribute("src")) });
    }
  } else {
    // Read serialized public page data, never execute its scripts or retrieve prompts.
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (typeof row.slug === "string" && typeof row.name === "string" && typeof row.kind === "string") {
        const prefix = shelf === "components" ? "c" : shelf === "sections" ? "s" : shelf === "ui" ? "u" : "s";
        items.push({ id: row.slug, title: row.name, description: typeof row.description === "string" ? row.description : "", source: `https://www.scrolltide.co/${shelf}#${prefix}-${encodeURIComponent(row.slug)}`, preview: https(row.posterImage) ?? https(row.previewVideo) });
        return;
      }
      Object.values(row).forEach(visit);
    };
    for (const script of document.querySelectorAll("script")) {
      const text = script.textContent ?? "";
      const prefix = "self.__next_f.push(";
      if (!text.startsWith(prefix)) continue;
      try {
        const entry = JSON.parse(text.slice(prefix.length).replace(/\);?\s*$/, ""));
        if (typeof entry[1] !== "string") continue;
        for (const line of entry[1].split("\n")) { const i = line.indexOf(":"); if (i < 0) continue; try { visit(JSON.parse(line.slice(i + 1))); } catch { /* Other stream records are not catalog JSON. */ } }
      } catch { /* Ignore non-JSON scripts. */ }
    }
  }
  return [...new Map(items.map(item => [item.id, { ...item, poster: item.preview ? posters.get(item.preview) ?? null : null }])).values()];
}
export async function browseCatalog(cursor?: string) {
  const index = cursor ? Number(cursor.replace("codehaven-shelf:", "")) : 0;
  const shelf = LIBRARY_SHELVES[index];
  if (!Number.isInteger(index) || !shelf || (cursor && !cursor.startsWith("codehaven-shelf:"))) throw new Error("Reload the Scrolltide library.");
  // Workers reject redirect:"error"; mcpFetch uses manual redirects and refuses 3xx.
  const response = await mcpFetch(`https://www.scrolltide.co/${shelf}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Scrolltide’s library is unavailable. Try again.");
  const items = parseCatalog(await response.text(), shelf);
  if (!items.length) throw new Error("Scrolltide’s catalog format changed. This shelf could not be loaded.");
  return { items, nextCursor: index + 1 < LIBRARY_SHELVES.length ? `codehaven-shelf:${index + 1}` : null, note: "" };
}