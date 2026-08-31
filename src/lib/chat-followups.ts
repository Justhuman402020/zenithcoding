const API_KEY_INTENT =
  /\b(?:paste|add|save|store|enter|connect|use|update|replace)\b[\s\S]{0,50}\b(?:api[\s_-]*key|secret|token)\b|\b(?:api[\s_-]*key|secret|token)\b[\s\S]{0,50}\b(?:paste|add|save|store|enter|connect|use|update|replace)\b/i;

const PROVIDER_KEYS: Array<[RegExp, string]> = [
  [/\bgroq\b/i, "GROQ_API_KEY"],
  [/\bopen\s*router\b/i, "OPENROUTER_API_KEY"],
  [/\bdeep\s*infra\b/i, "DEEPINFRA_API_KEY"],
  [/\bgoogle(?:\s+ai(?:\s+studio)?)?|\bgemini\b/i, "GOOGLE_AI_STUDIO_API_KEY"],
  [/\bmistral\b/i, "MISTRAL_API_KEY"],
  [/\bcerebras\b/i, "CEREBRAS_API_KEY"],
  [/\bopen\s*ai\b/i, "OPENAI_API_KEY"],
  [/\banthropic\b|\bclaude\b/i, "ANTHROPIC_API_KEY"],
  [/\bstripe\b/i, "STRIPE_SECRET_KEY"],
  [/\btelegram\b/i, "TELEGRAM_BOT_TOKEN"],
];

export type SecretIntent = { key: string; reason: string; value?: string };

export function detectSecretIntent(text: string): SecretIntent | null {
  if (!API_KEY_INTENT.test(text)) return null;
  const provider = PROVIDER_KEYS.find(([pattern]) => pattern.test(text));
  const key = provider?.[1] ?? "API_KEY";
  return { key, reason: reasonFor(key) };
}

function reasonFor(key: string) {
  const label = key.replace(/_(?:API_KEY|SECRET_KEY|BOT_TOKEN)$/, "").replaceAll("_", " ");
  return `Connect ${label.toLowerCase()} to this project.`;
}

// Raw key shapes. Detecting the pasted value itself means the secure box opens
// with zero extra clicks and the key never travels to the model in chat text.
const RAW_KEY_PATTERNS: Array<[RegExp, string]> = [
  [/\bgsk_[A-Za-z0-9]{20,}\b/, "GROQ_API_KEY"],
  [/\bsk-or-v1-[A-Za-z0-9]{20,}\b/, "OPENROUTER_API_KEY"],
  [/\bxai-[A-Za-z0-9]{20,}\b/, "XAI_API_KEY"],
  [/\bsk-ant-[A-Za-z0-9\-_]{20,}\b/, "ANTHROPIC_API_KEY"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/, "STRIPE_SECRET_KEY"],
  [/\bAIza[0-9A-Za-z\-_]{30,}\b/, "GOOGLE_AI_STUDIO_API_KEY"],
  [/\bhf_[A-Za-z0-9]{20,}\b/, "HUGGINGFACE_API_KEY"],
  [/\bgh[pous]_[A-Za-z0-9]{20,}\b/, "GITHUB_TOKEN"],
  [/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/, "TELEGRAM_BOT_TOKEN"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "OPENAI_API_KEY"],
];

/** Finds an API key that was pasted directly into the chat box. */
export function detectPastedApiKey(text: string): SecretIntent | null {
  for (const [pattern, key] of RAW_KEY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { key, reason: reasonFor(key), value: match[0] };
  }
  return null;
}

/** Removes a pasted key from chat text so it is never sent to the model. */
export function stripApiKey(text: string, value: string) {
  return text.split(value).join("").replace(/\s{2,}/g, " ").trim();
}

/** OpenAI-compatible base URL used to verify a saved key right after saving. */
export function providerBaseUrlForKey(key: string): string | null {
  const map: Record<string, string> = {
    GROQ_API_KEY: "https://api.groq.com/openai/v1",
    OPENROUTER_API_KEY: "https://openrouter.ai/api/v1",
    DEEPINFRA_API_KEY: "https://api.deepinfra.com/v1/openai",
    GOOGLE_AI_STUDIO_API_KEY: "https://generativelanguage.googleapis.com/v1beta/openai",
    MISTRAL_API_KEY: "https://api.mistral.ai/v1",
    CEREBRAS_API_KEY: "https://api.cerebras.ai/v1",
    OPENAI_API_KEY: "https://api.openai.com/v1",
    XAI_API_KEY: "https://api.x.ai/v1",
  };
  return map[key] ?? null;
}

export function buildFollowUpSuggestion(prompt: string, changedPaths: string[]): string {
  const lower = prompt.toLowerCase();
  const target = changedPaths.find((path) => /index|home/i.test(path)) ?? changedPaths[0];
  if (/home|menu|navigation|nav\b/.test(lower)) return "Now make the home menu fully responsive and test every action";
  if (/sign\s*up|signup|login|auth/.test(lower)) return "Now connect the form states and test sign-up on mobile";
  if (/api|integration|key|secret/.test(lower)) return "Now connect the saved key and test one real request with clear errors";
  if (/image|photo|screenshot|design/.test(lower)) return "Now polish the mobile layout to match the image more closely";
  if (/fix|broken|error|fail/.test(lower)) return "Now test the repaired flow from start to finish and fix anything remaining";
  if (target) return `Now polish ${target} for mobile and verify every interaction`;
  if (lower.trim()) return `Now continue from "${prompt.trim().slice(0, 60)}" and improve the next most important part`;
  return "Now test this build on mobile and improve the next most important screen";
}
