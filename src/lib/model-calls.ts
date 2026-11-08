export type CallSection = "plan" | "build" | "image_build" | "chat" | "assistant" | "skill" | "browser_test";

export const SECTION_LABELS: Record<CallSection, string> = {
  plan: "Plan",
  build: "Build",
  image_build: "Image build",
  chat: "Chat",
  assistant: "Assistant chat",
  skill: "Skill",
  browser_test: "Browser test",
};

export function classifySection(o: { plan?: boolean; imageBuild?: boolean; fileChange?: boolean; skill?: boolean }): CallSection {
  if (o.plan) return "plan";
  if (o.skill) return "skill";
  if (o.imageBuild) return "image_build";
  if (o.fileChange) return "build";
  return "chat";
}

export type ProviderBrand = "openrouter" | "cloudflare" | "ollama" | "google" | "groq" | "cerebras" | "deepinfra" | "github" | "other";

export function providerBrand(provider: string, baseUrl?: string | null): ProviderBrand {
  const s = `${provider} ${baseUrl ?? ""}`.toLowerCase();
  if (s.includes("openrouter")) return "openrouter";
  if (s.includes("cloudflare") || s.includes("workers") || /^cf[-_]/.test(provider.toLowerCase())) return "cloudflare";
  if (s.includes("ollama")) return "ollama";
  if (s.includes("google") || s.includes("gemini") || s.includes("generativelanguage")) return "google";
  if (s.includes("groq")) return "groq";
  if (s.includes("cerebras")) return "cerebras";
  if (s.includes("deepinfra")) return "deepinfra";
  if (s.includes("github") || s.includes("models.inference.ai")) return "github";
  return "other";
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
