const API_KEY_INTENT =
  /\b(?:paste|add|save|store|enter|connect|use|update|replace)\b[\s\S]{0,50}\b(?:api[\s_-]*key|access[\s_-]*key|secret|token|key)\b|\b(?:api[\s_-]*key|secret|token)\b[\s\S]{0,50}\b(?:paste|add|save|store|enter|connect|use|update|replace)\b/i;

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

export type SecretIntent = { key: string; reason: string };

export function detectSecretIntent(text: string): SecretIntent | null {
  if (!API_KEY_INTENT.test(text)) return null;
  const provider = PROVIDER_KEYS.find(([pattern]) => pattern.test(text));
  const key = provider?.[1] ?? "API_KEY";
  const label = key.replace(/_(?:API_KEY|SECRET_KEY|BOT_TOKEN)$/, "").replaceAll("_", " ");
  return { key, reason: `Connect ${label.toLowerCase()} to this project.` };
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
  return "Now test this build on mobile and improve the next most important screen";
}