// Shared (client + server safe) list of Groq chat models the editor can use.
// Order matters: it doubles as the automatic fallback chain when a model is
// rate limited (429) or unavailable on the current Groq key.
//
// `vision` marks models that accept image input. `tools` marks models that can
// call the file tools — a model without tools can never perform a build, so it
// is never used as a fallback for an edit request.

export type GroqModelOption = {
  id: string;
  label: string;
  hint: string;
  vision: boolean;
  tools: boolean;
};

export const GROQ_MODELS: GroqModelOption[] = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Best quality. Text only.", vision: false, tools: true },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (vision)", hint: "Understands screenshots and images.", vision: true, tools: true },
  { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B (vision)", hint: "Backup vision model.", vision: true, tools: true },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "Faster, lighter, higher limits.", vision: false, tools: true },
];

export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;
export const DEFAULT_VISION_GROQ_MODEL = "qwen/qwen3.8-27b";

export const GROQ_MODEL_STORAGE_KEY = "forge:groq-model";

export function isKnownGroqModel(id: string | null | undefined): id is string {
  return !!id && GROQ_MODELS.some((model) => model.id === id);
}

export function modelSupportsVision(id: string) {
  return GROQ_MODELS.find((model) => model.id === id)?.vision ?? false;
}

/**
 * Preferred model first, then every other tool-capable model as automatic
 * fallback. When the message carries images, only vision models are used so
 * the screenshot is never silently dropped.
 */
export function buildGroqModelChain(preferred?: string | null, opts?: { vision?: boolean }): string[] {
  const usable = GROQ_MODELS.filter((model) => model.tools && (!opts?.vision || model.vision));
  const preferredOk = isKnownGroqModel(preferred) && usable.some((model) => model.id === preferred);
  const first = preferredOk ? preferred : (usable[0]?.id ?? DEFAULT_GROQ_MODEL);
  return [first, ...usable.map((model) => model.id).filter((id) => id !== first)];
}

export function readStoredGroqModel(): string {
  if (typeof window === "undefined") return DEFAULT_GROQ_MODEL;
  const stored = window.localStorage.getItem(GROQ_MODEL_STORAGE_KEY);
  return isKnownGroqModel(stored) ? stored : DEFAULT_GROQ_MODEL;
}
