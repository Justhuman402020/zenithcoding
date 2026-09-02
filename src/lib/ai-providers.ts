// Shared (client + server safe) registry of every AI provider Forge can use
// for coding, plus their free/low-cost models. Order matters: it doubles as
// the automatic fallback chain when a model is rate limited or unavailable.

export type ModelOption = {
  id: string; // provider model id
  label: string;
  hint: string;
  vision: boolean;
  tools: boolean;
  /** Rough free-tier request budget per day, used when the API sends no headers. */
  freeDaily?: number;
  /** True when this model can be used at no cost on the provider's free tier. */
  free?: boolean;
  /** Small/fast model (roughly 32B parameters or less). */
  lightweight?: boolean;
};

export type ProviderOption = {
  id: string;
  label: string;
  envKey: string;
  baseURL: string;
  docs: string;
  models: ModelOption[];
  /** Provider gives every model away on a free tier (no card needed). */
  freeTier?: boolean;
};

export const PROVIDERS: ProviderOption[] = [
  {
    id: "groq",
    freeTier: true,
    label: "Groq",
    envKey: "GROQ_API_KEY",
    baseURL: "https://api.groq.com/openai/v1",
    docs: "https://console.groq.com/keys",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Best quality. Text only.", vision: false, tools: true, freeDaily: 1000 },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "Faster, higher limits.", vision: false, tools: true, freeDaily: 1000 },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", hint: "Reads screenshots.", vision: true, tools: true, freeDaily: 1000 },
      { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", hint: "Backup vision model.", vision: true, tools: true, freeDaily: 1000 },
    ],
  },
  {
    id: "cerebras",
    freeTier: true,
    label: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    baseURL: "https://api.cerebras.ai/v1",
    docs: "https://cloud.cerebras.ai",
    models: [
      { id: "qwen-3-coder-480b", label: "Qwen3 Coder 480B", hint: "Very fast coding model.", vision: false, tools: true, freeDaily: 1000 },
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", hint: "Strong general coder.", vision: false, tools: true, freeDaily: 1000 },
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", hint: "Reliable fallback.", vision: false, tools: true, freeDaily: 1000 },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api/v1",
    docs: "https://openrouter.ai/keys",
    models: [
      { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder (free)", hint: "Free coding model.", vision: false, tools: true, freeDaily: 50 },
      { id: "deepseek/deepseek-chat-v3.1:free", label: "DeepSeek V3.1 (free)", hint: "Free, good reasoning.", vision: false, tools: true, freeDaily: 50 },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", hint: "Free general model.", vision: false, tools: true, freeDaily: 50 },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)", hint: "Free and reads images.", vision: true, tools: true, freeDaily: 50 },
    ],
  },
  {
    id: "google",
    freeTier: true,
    label: "Google AI Studio",
    envKey: "GOOGLE_AI_STUDIO_API_KEY",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    docs: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Free tier, reads images.", vision: true, tools: true, freeDaily: 250 },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", hint: "Highest free limits.", vision: true, tools: true, freeDaily: 1000 },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Backup vision model.", vision: true, tools: true, freeDaily: 200 },
    ],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    envKey: "DEEPINFRA_API_KEY",
    baseURL: "https://api.deepinfra.com/v1/openai",
    docs: "https://deepinfra.com/dash",
    models: [
      { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", label: "Qwen3 Coder 480B", hint: "Big coding model.", vision: false, tools: true },
      { id: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B", hint: "Cheap general model.", vision: false, tools: true },
      { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3", hint: "Strong reasoning.", vision: false, tools: true },
    ],
  },
  {
    id: "llm7",
    freeTier: true,
    label: "LLM7",
    envKey: "LLM7_API_KEY",
    baseURL: "https://api.llm7.io/v1",
    docs: "https://token.llm7.io",
    models: [
      { id: "gpt-5-mini", label: "GPT-5 Mini (free)", hint: "Free relay model.", vision: true, tools: true, freeDaily: 100 },
      { id: "deepseek-r1", label: "DeepSeek R1 (free)", hint: "Free reasoning model.", vision: false, tools: true, freeDaily: 100 },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseURL: "https://api.openai.com/v1",
    docs: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", hint: "Cheap and reads images.", vision: true, tools: true },
      { id: "gpt-4o", label: "GPT-4o", hint: "Strong general model.", vision: true, tools: true },
    ],
  },
  {
    id: "mistral",
    freeTier: true,
    label: "Mistral",
    envKey: "MISTRAL_API_KEY",
    baseURL: "https://api.mistral.ai/v1",
    docs: "https://console.mistral.ai/api-keys",
    models: [
      { id: "codestral-latest", label: "Codestral", hint: "Made for code.", vision: false, tools: true, freeDaily: 500 },
      { id: "mistral-large-latest", label: "Mistral Large", hint: "Best Mistral quality.", vision: false, tools: true, freeDaily: 500 },
      { id: "pixtral-12b-2409", label: "Pixtral 12B", hint: "Reads images.", vision: true, tools: true, freeDaily: 500 },
    ],
  },
];

export type ModelRef = { provider: string; model: string };

export const DEFAULT_MODEL_REF: ModelRef = { provider: "groq", model: "openai/gpt-oss-120b" };

export const MODEL_STORAGE_KEY = "forge:ai-model";

export function modelKey(ref: ModelRef) {
  return `${ref.provider}:${ref.model}`;
}

/** Accepts any model id belonging to a known provider (live-discovered ones included). */
export function parseModelKey(value: string | null | undefined): ModelRef | null {
  if (!value) return null;
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const provider = value.slice(0, idx);
  const model = value.slice(idx + 1);
  if (!model || (!findProvider(provider) && !provider.startsWith("custom-"))) return null;
  return { provider, model };
}

export function findProvider(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

export function findModel(provider: string, model: string) {
  return findProvider(provider)?.models.find((m) => m.id === model);
}

const VISION_HINT = /(?:^|[-_/.])(vl|vision|gemini|pixtral|llava|maverick|scout|multimodal|image|omni)(?:$|[-_/.])|gpt-4o|qwen[^/]*(?:vl|vision)/i;
const NON_CHAT_HINT =
  /(whisper|tts|embed|embedding|rerank|guard|moderation|safety|bge|clip|stable-diffusion|flux|sdxl|image-gen|transcribe|speech|audio|prompt-guard)/i;

/** Model families that are always free to call (open weights on free tiers). */
const FREE_ID_HINT =
  /(:free$|free-?tier|gpt-oss|gemma|phi-|smol|tinyllama|qwen[23]|llama-?3|llama-?4|mistral-7b|ministral|granite|deepseek|glm-|apertus|nemotron)/i;

/** Small, cheap-to-run models — 32B parameters or less, or explicitly "mini/lite/flash". */
const LIGHTWEIGHT_HINT =
  /(?:^|[^0-9])([0-4]?[0-9])\s?b(?:$|[^a-z0-9])|(mini|lite|small|tiny|flash|nano|instant|8b|7b|4b|3b|2b|1\.5b)/i;

/** True when a model can be used at no cost, either by provider free tier or open weights. */
export function isFreeModel(provider: string, id: string): boolean {
  const option = findProvider(provider);
  if (option?.freeTier) return true;
  return FREE_ID_HINT.test(id);
}

/** True when a model is small/fast (good when big models are rate limited). */
export function isLightweightModel(id: string): boolean {
  const size = /(\d{2,4})\s?b(?:$|[^a-z0-9])/i.exec(id);
  if (size) return Number(size[1]) <= 32;
  return LIGHTWEIGHT_HINT.test(id);
}

/** Best-effort capabilities for a model we discovered from a provider's API. */
export function guessModelMeta(provider: string, id: string): ModelOption {
  const known = findModel(provider, id);
  if (known) {
    return {
      ...known,
      free: known.free ?? isFreeModel(provider, id),
      lightweight: known.lightweight ?? isLightweightModel(id),
    };
  }
  return {
    id,
    label: id,
    hint: "Discovered from your API key.",
    vision: VISION_HINT.test(id),
    tools: !NON_CHAT_HINT.test(id),
    free: isFreeModel(provider, id),
    lightweight: isLightweightModel(id),
  };
}

export function isChatModelId(id: string) {
  return !NON_CHAT_HINT.test(id);
}

export function allModelRefs(): Array<ModelRef & ModelOption & { providerLabel: string }> {
  return PROVIDERS.flatMap((provider) =>
    provider.models.map((model) => ({
      ...model,
      provider: provider.id,
      model: model.id,
      providerLabel: provider.label,
    })),
  );
}

/**
 * Preferred model first, then every other usable model as automatic fallback,
 * so a job never cuts off when one provider runs out. `availableProviders`
 * filters out providers with no API key configured. When the message carries
 * images only vision models are used. The preferred model is always kept
 * first, even when it was discovered live rather than curated here.
 */
export function buildModelChain(
  preferred: ModelRef | null,
  opts: { vision?: boolean; availableProviders?: string[] } = {},
): ModelRef[] {
  const usable = allModelRefs().filter(
    (entry) =>
      entry.tools &&
      (!opts.vision || entry.vision) &&
      (!opts.availableProviders || opts.availableProviders.includes(entry.provider)),
  );
  const chain = usable.map((entry) => ({ provider: entry.provider, model: entry.model }));
  if (!preferred) return chain;
  const providerOk = !opts.availableProviders || opts.availableProviders.includes(preferred.provider);
  const meta = guessModelMeta(preferred.provider, preferred.model);
  const preferredUsable = providerOk && meta.tools && (!opts.vision || meta.vision);
  if (!preferredUsable) return chain;
  return [
    preferred,
    ...chain.filter((ref) => !(ref.provider === preferred.provider && ref.model === preferred.model)),
  ];
}

export function modelSupportsVision(ref: ModelRef) {
  return guessModelMeta(ref.provider, ref.model).vision;
}

export function readStoredModelRef(): ModelRef | null {
  if (typeof window === "undefined") return null;
  return parseModelKey(window.localStorage.getItem(MODEL_STORAGE_KEY));
}

