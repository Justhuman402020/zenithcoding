export type IntegrationField = { key: string; label: string; required: boolean; placeholder: string };
export type IntegrationDef = { id: string; name: string; purpose: string; getUrl: string; fields: IntegrationField[] };

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "unsplash",
    name: "Unsplash",
    purpose: "Free stock photos",
    getUrl: "https://unsplash.com/oauth/applications",
    fields: [
      { key: "accessKey", label: "Access Key", required: true, placeholder: "Paste Unsplash Access Key" },
      { key: "secretKey", label: "Secret Key", required: false, placeholder: "Paste Unsplash Secret Key" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    purpose: "Many AI models with one key",
    getUrl: "https://openrouter.ai/keys",
    fields: [{ key: "apiKey", label: "API Key", required: true, placeholder: "sk-or-..." }],
  },
  {
    id: "tavily",
    name: "Tavily",
    purpose: "Web search for the agent",
    getUrl: "https://app.tavily.com",
    fields: [{ key: "apiKey", label: "API Key", required: true, placeholder: "tvly-..." }],
  },
  {
    id: "github",
    name: "GitHub",
    purpose: "Repos and code pushes",
    getUrl: "https://github.com/settings/tokens",
    fields: [{ key: "token", label: "Personal Access Token", required: true, placeholder: "ghp_... or github_pat_..." }],
  },
  {
    id: "e2b",
    name: "E2B",
    purpose: "Safe cloud boxes to run code",
    getUrl: "https://e2b.dev/dashboard",
    fields: [{ key: "apiKey", label: "API Key", required: true, placeholder: "e2b_..." }],
  },
  {
    id: "neon",
    name: "Neon",
    purpose: "Postgres databases",
    getUrl: "https://console.neon.tech/app/settings/api-keys",
    fields: [{ key: "apiKey", label: "API Key", required: true, placeholder: "napi_..." }],
  },
];
