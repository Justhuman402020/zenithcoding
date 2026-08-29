// Shared (client + server safe) list of Groq chat models the editor can use.
// Order matters: it doubles as the automatic fallback chain when a model is
// rate limited (429) or unavailable on the current Groq key.

export type GroqModelOption = {
  id: string;
  label: string;
  hint: string;
};

export const GROQ_MODELS: GroqModelOption[] = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Best quality. Default." },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "Faster, lighter, higher limits." },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", hint: "Strong at code." },
  { id: "groq/compound", label: "Groq Compound", hint: "Backup when others are busy." },
];

export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;

export const GROQ_MODEL_STORAGE_KEY = "forge:groq-model";

export function isKnownGroqModel(id: string | null | undefined): id is string {
  return !!id && GROQ_MODELS.some((model) => model.id === id);
}

/** Preferred model first, then every other model as automatic fallback. */
export function buildGroqModelChain(preferred?: string | null): string[] {
  const first = isKnownGroqModel(preferred) ? preferred : DEFAULT_GROQ_MODEL;
  return [first, ...GROQ_MODELS.map((model) => model.id).filter((id) => id !== first)];
}

export function readStoredGroqModel(): string {
  if (typeof window === "undefined") return DEFAULT_GROQ_MODEL;
  const stored = window.localStorage.getItem(GROQ_MODEL_STORAGE_KEY);
  return isKnownGroqModel(stored) ? stored : DEFAULT_GROQ_MODEL;
}
