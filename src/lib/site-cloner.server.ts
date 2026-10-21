// Website cloner: fetch a page and boil it down to a tiny design blueprint
// (~300 tokens) so small-context models can rebuild a matching page.

const URL_RE = /https?:\/\/[^\s<>"')]+/i;
const CLONE_INTENT = /\b(clone|copy|replicate|recreate|rebuild|mimic|like this (site|website|page)|same as|look like)\b/i;

export function detectCloneUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m || !CLONE_INTENT.test(text)) return null;
  return m[0].replace(/[.,;]+$/, "");
}

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

export async function buildSiteBlueprint(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CodeHaven/1.0)", Accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const raw = (await res.text()).slice(0, 600_000);
    const html = raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    const abs = (u: string) => {
      try { return new URL(u, url).href; } catch { return ""; }
    };

    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 80);
    const styles = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join(" ") + " " + (html.match(/style="[^"]*"/gi) ?? []).join(" ");
    const colorCounts = new Map<string, number>();
    for (const c of styles.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []) {
      const k = c.toLowerCase();
      colorCounts.set(k, (colorCounts.get(k) ?? 0) + 1);
    }
    const theme = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i)?.[1];
    const colors = uniq([...(theme ? [theme] : []), ...[...colorCounts].sort((a, b) => b[1] - a[1]).map(([c]) => c)]).slice(0, 6);
    const fonts = uniq((styles.match(/font-family:\s*([^;"}]+)/gi) ?? []).map((f) => f.replace(/font-family:\s*/i, "").split(",")[0].replace(/['"]/g, "").trim())).slice(0, 2);

    const navHtml = html.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? "";
    const nav = uniq((navHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) ?? []).map(strip).filter((t) => t && t.length < 25)).slice(0, 7);
    const headings = uniq((html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) ?? []).map(strip).filter((t) => t.length > 2)).slice(0, 7).map((t) => t.slice(0, 60));
    const buttons = uniq((html.match(/<button[^>]*>([\s\S]*?)<\/button>/gi) ?? []).map(strip).filter((t) => t && t.length < 25)).slice(0, 4);
    const sections = uniq((html.match(/<(section|header|footer|main|aside)\b[^>]*?(?:id|class)="([^"]*)"/gi) ?? [])
      .map((s) => s.match(/<(\w+)/)?.[1] + ":" + (s.match(/(?:id|class)="([^"\s]*)/)?.[1] ?? "")))
      .slice(0, 8);
    const images = uniq((html.match(/<img[^>]+src="([^"]+)"/gi) ?? [])
      .map((m) => abs(m.match(/src="([^"]+)"/i)?.[1] ?? ""))
      .filter((u) => u.startsWith("http") && !u.startsWith("data:")))
      .slice(0, 5);

    const lines = [
      `Source: ${url}`,
      title && `Title: ${title}`,
      colors.length && `Colors: ${colors.join(", ")}`,
      fonts.length && `Fonts: ${fonts.join(", ")}`,
      nav.length && `Nav: ${nav.join(" | ")}`,
      sections.length && `Sections: ${sections.join(", ")}`,
      headings.length && `Headings: ${headings.join(" | ")}`,
      buttons.length && `Buttons: ${buttons.join(" | ")}`,
      images.length && `Images: ${images.join(" ")}`,
    ].filter(Boolean) as string[];
    // ~4 chars/token → keep under 300 tokens.
    return lines.join("\n").slice(0, 1150);
  } catch {
    return null;
  }
}
