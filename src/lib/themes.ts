import mathWallpaper from "@/assets/math-wallpaper.jpg.asset.json";
// Site themes: drawn SVG doodle backgrounds + color tokens. No images, no network.
export type SiteTheme = {
  id: string; name: string; emoji: string;
  base: string; card: string; primary: string; primaryFg: string; fg: string; muted: string; accent: string;
  ink: string; glyphs: string[];
};

export const THEMES: SiteTheme[] = [
  { id: "black", name: "Pure Black", emoji: "⚫", base: "#000000", card: "#141414", primary: "#fafafa", primaryFg: "#000000", fg: "#f5f5f5", muted: "#a3a3a3", accent: "#262626", ink: "transparent", glyphs: [] },
  { id: "math", name: "Mathematics", emoji: "📐", base: "#0d100f", card: "#181d1b", primary: "#7fd1b9", primaryFg: "#08120e", fg: "#eef4f1", muted: "#9fb3aa", accent: "#24302b", ink: "rgba(255,255,255,0.09)", glyphs: ["∑", "π", "√x", "x²", "∫", "÷", "∞", "△", "≠", "f(x)", "θ", "±", "%", "7", "3"] },
  { id: "space", name: "Space", emoji: "🪐", base: "#14112b", card: "#1f1a40", primary: "#a78bfa", primaryFg: "#120e26", fg: "#f1eeff", muted: "#a8a1cf", accent: "#2d2660", ink: "rgba(255,255,255,0.10)", glyphs: ["✦", "☾", "🪐", "★", "✧", "☄", "◯", "·"] },
  { id: "party", name: "Party", emoji: "🎉", base: "#2a1630", card: "#3a1f43", primary: "#ff6fb5", primaryFg: "#2a0b1c", fg: "#fff0f8", muted: "#d4a8c4", accent: "#4d2a57", ink: "rgba(255,255,255,0.10)", glyphs: ["🎈", "✶", "♪", "🎁", "✿", "♥", "◆"] },
  { id: "forest", name: "Forest", emoji: "🌿", base: "#13261c", card: "#1b3326", primary: "#5fd38d", primaryFg: "#082012", fg: "#ecfaf1", muted: "#98c2a8", accent: "#244432", ink: "rgba(255,255,255,0.09)", glyphs: ["🌿", "❦", "🍃", "✿", "☘", "⌘", "·"] },
  { id: "ocean", name: "Ocean", emoji: "🐳", base: "#0d2233", card: "#133047", primary: "#38d1e0", primaryFg: "#051a22", fg: "#e9fbff", muted: "#8fbccc", accent: "#1a3f5a", ink: "rgba(255,255,255,0.09)", glyphs: ["〜", "🐟", "◌", "⚓", "≈", "○", "🐚"] },
  { id: "sunset", name: "Sunset", emoji: "🌅", base: "#2e1a14", card: "#3d241b", primary: "#ffa94d", primaryFg: "#2a1405", fg: "#fff3e8", muted: "#d6b49c", accent: "#553226", ink: "rgba(255,255,255,0.09)", glyphs: ["☀", "☁", "〰", "✺", "△", "·"] },
  { id: "code", name: "Code", emoji: "💻", base: "#111418", card: "#1a1f25", primary: "#4ade80", primaryFg: "#06130b", fg: "#e7f7ec", muted: "#8ea69a", accent: "#22302a", ink: "rgba(74,222,128,0.10)", glyphs: ["{ }", "</>", "=>", "01", ";", "[ ]", "#", "&&"] },
  { id: "love", name: "Love", emoji: "💜", base: "#24132a", card: "#331b3b", primary: "#c084fc", primaryFg: "#1d0a26", fg: "#faefff", muted: "#c3a3d1", accent: "#45264f", ink: "rgba(255,255,255,0.10)", glyphs: ["♥", "♡", "✉", "✿", "❀", "·"] },
  { id: "light", name: "Day", emoji: "☀️", base: "#f3efe6", card: "#ffffff", primary: "#7c3aed", primaryFg: "#ffffff", fg: "#1c1a22", muted: "#6b6575", accent: "#e8e0f5", ink: "rgba(30,20,60,0.08)", glyphs: ["∑", "✎", "★", "π", "✿", "△", "♪"] },
];

export const DEFAULT_THEME = "black";
export const themeById = (id?: string | null) => THEMES.find((t) => t.id === id) ?? THEMES[0]!;

/** Builds a tiled doodle SVG as a CSS url(). Deterministic layout per theme. */
export function doodleUrl(t: SiteTheme): string {
  if (!t.glyphs.length) return "none";
  if (t.id === "math") return `url("${mathWallpaper.url}")`;
  const size = 240;
  let seed = [...t.id].reduce((a, c) => a + c.charCodeAt(0), 7);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const items: string[] = [];
  for (let i = 0; i < 16; i++) {
    const g = t.glyphs[i % t.glyphs.length]!.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const x = Math.round((i % 4) * 60 + rnd() * 30 + 6);
    const y = Math.round(Math.floor(i / 4) * 60 + rnd() * 30 + 22);
    const r = Math.round(rnd() * 60 - 30);
    const fs = Math.round(14 + rnd() * 12);
    items.push(`<text x='${x}' y='${y}' font-size='${fs}' transform='rotate(${r} ${x} ${y})' fill='${t.ink}' font-family='Georgia,serif'>${g}</text>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${items.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const KEY = "ch-theme";
export function applyTheme(id: string) {
  if (typeof document === "undefined") return;
  const t = themeById(id);
  const r = document.documentElement.style;
  r.setProperty("--theme-base", t.base);
  const solid = t.id === "black";
  r.setProperty("--background", solid ? t.base : `color-mix(in oklab, ${t.base} 72%, transparent)`);
  r.setProperty("--foreground", t.fg);
  r.setProperty("--card", solid ? t.card : `color-mix(in oklab, ${t.card} 92%, transparent)`);
  r.setProperty("--border", solid ? "#2a2a2a" : "");
  r.setProperty("--input", solid ? "#2a2a2a" : "");
  r.setProperty("--font-sans", solid ? '"Inter Tight", "Helvetica Neue", Arial, system-ui, sans-serif' : "");
  r.setProperty("--card-foreground", t.fg);
  r.setProperty("--popover", t.card);
  r.setProperty("--popover-foreground", t.fg);
  r.setProperty("--primary", t.primary);
  r.setProperty("--primary-foreground", t.primaryFg);
  r.setProperty("--muted", `color-mix(in oklab, ${t.accent} 80%, transparent)`);
  r.setProperty("--muted-foreground", t.muted);
  r.setProperty("--accent", t.accent);
  r.setProperty("--secondary", t.accent);
  r.setProperty("--sidebar", t.card);
  r.setProperty("--theme-doodle", doodleUrl(t));
  r.setProperty("--theme-size", t.id === "math" ? "904px auto" : "240px 240px");
}
export const readLocalTheme = () => (typeof localStorage === "undefined" ? DEFAULT_THEME : localStorage.getItem(KEY) || DEFAULT_THEME);
export const writeLocalTheme = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } };
