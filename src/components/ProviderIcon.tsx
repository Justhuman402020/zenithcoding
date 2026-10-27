import { Bot, Cloud, Cpu, Github, Sparkles, Zap, Server } from "lucide-react";
import { providerBrand, type ProviderBrand } from "@/lib/model-calls";

function OpenRouterMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className} aria-label="OpenRouter">
      <path d="M2 12h5c3 0 4-6 8-6h3" />
      <path d="M2 12h5c3 0 4 6 8 6h3" />
      <path d="M16 3l3 3-3 3" />
      <path d="M16 15l3 3-3 3" />
    </svg>
  );
}

const NAMES: Record<ProviderBrand, string> = { openrouter: "OpenRouter", cloudflare: "Cloudflare", ollama: "Ollama", google: "Google", groq: "Groq", cerebras: "Cerebras", deepinfra: "DeepInfra", github: "GitHub Models", other: "Other" };

export function providerName(provider: string, baseUrl?: string | null) {
  return NAMES[providerBrand(provider, baseUrl)];
}

export function ProviderIcon({ provider, baseUrl, className = "h-4 w-4" }: { provider: string; baseUrl?: string | null; className?: string }) {
  const b = providerBrand(provider, baseUrl);
  if (b === "openrouter") return <OpenRouterMark className={className} />;
  if (b === "cloudflare") return <Cloud className={className} aria-label="Cloudflare" />;
  if (b === "ollama") return <Bot className={className} aria-label="Ollama" />;
  if (b === "google") return <Sparkles className={className} aria-label="Google" />;
  if (b === "groq") return <Zap className={className} aria-label="Groq" />;
  if (b === "cerebras") return <Cpu className={className} aria-label="Cerebras" />;
  if (b === "github") return <Github className={className} aria-label="GitHub Models" />;
  return <Server className={className} aria-label="Provider" />;
}
