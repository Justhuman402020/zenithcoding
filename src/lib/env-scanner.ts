// Scans project files for every environment key the code needs.
// Client-safe: no secrets here, only names and beginner-friendly help.

export type DetectedEnv = {
  key: string;
  service: string;
  powers: string;
  howTo: string;
  link?: string;
  clientSide: boolean;
  foundIn: string[];
  exampleValue?: string;
};

type CatalogEntry = { match: RegExp; service: string; powers: string; howTo: string; link?: string };

const CATALOG: CatalogEntry[] = [
  { match: /SUPABASE_URL/, service: "Supabase", powers: "Database, login and storage address", howTo: "Open your Supabase project → Settings → API → copy “Project URL”.", link: "https://supabase.com/dashboard/project/_/settings/api" },
  { match: /SUPABASE_(ANON|PUBLISHABLE)/, service: "Supabase", powers: "Public key so the site can read data and sign users in", howTo: "Supabase → Settings → API → copy the “anon / publishable” key.", link: "https://supabase.com/dashboard/project/_/settings/api" },
  { match: /SUPABASE_SERVICE/, service: "Supabase", powers: "Admin key for server work (keep private)", howTo: "Supabase → Settings → API → copy the “service_role” key. Never share it.", link: "https://supabase.com/dashboard/project/_/settings/api" },
  { match: /SUPABASE_PROJECT_ID/, service: "Supabase", powers: "Project ID", howTo: "Supabase → Settings → General → Reference ID.", link: "https://supabase.com/dashboard" },
  { match: /STRIPE_(PUBLISHABLE|PUBLIC)/, service: "Stripe", powers: "Shows the checkout / card form", howTo: "Stripe Dashboard → Developers → API keys → copy “Publishable key” (pk_…).", link: "https://dashboard.stripe.com/apikeys" },
  { match: /STRIPE_WEBHOOK/, service: "Stripe", powers: "Confirms payments sent back by Stripe", howTo: "Stripe → Developers → Webhooks → your endpoint → “Signing secret” (whsec_…).", link: "https://dashboard.stripe.com/webhooks" },
  { match: /STRIPE/, service: "Stripe", powers: "Takes payments", howTo: "Stripe Dashboard → Developers → API keys → copy “Secret key” (sk_…).", link: "https://dashboard.stripe.com/apikeys" },
  { match: /OPENAI/, service: "OpenAI", powers: "AI chat / text generation", howTo: "platform.openai.com → API keys → Create new secret key.", link: "https://platform.openai.com/api-keys" },
  { match: /ANTHROPIC|CLAUDE/, service: "Anthropic", powers: "Claude AI", howTo: "console.anthropic.com → API Keys → Create key.", link: "https://console.anthropic.com/settings/keys" },
  { match: /GEMINI|GOOGLE_AI|GOOGLE_GENERATIVE/, service: "Google AI", powers: "Gemini AI", howTo: "aistudio.google.com → Get API key.", link: "https://aistudio.google.com/app/apikey" },
  { match: /GROQ/, service: "Groq", powers: "Fast AI models", howTo: "console.groq.com → API Keys → Create.", link: "https://console.groq.com/keys" },
  { match: /OPENROUTER/, service: "OpenRouter", powers: "Many AI models through one key", howTo: "openrouter.ai → Keys → Create key.", link: "https://openrouter.ai/keys" },
  { match: /XAI|GROK/, service: "xAI", powers: "Grok AI", howTo: "console.x.ai → API Keys.", link: "https://console.x.ai" },
  { match: /MISTRAL/, service: "Mistral", powers: "Mistral AI", howTo: "console.mistral.ai → API Keys.", link: "https://console.mistral.ai/api-keys" },
  { match: /REPLICATE/, service: "Replicate", powers: "Image / video AI", howTo: "replicate.com → Account → API tokens.", link: "https://replicate.com/account/api-tokens" },
  { match: /ELEVENLABS/, service: "ElevenLabs", powers: "Voice / text-to-speech", howTo: "elevenlabs.io → Profile → API key.", link: "https://elevenlabs.io/app/settings/api-keys" },
  { match: /TWILIO/, service: "Twilio", powers: "SMS and phone calls", howTo: "console.twilio.com → Account Info (SID + Auth Token).", link: "https://console.twilio.com" },
  { match: /RESEND/, service: "Resend", powers: "Sending emails", howTo: "resend.com → API Keys → Create.", link: "https://resend.com/api-keys" },
  { match: /SENDGRID/, service: "SendGrid", powers: "Sending emails", howTo: "SendGrid → Settings → API Keys.", link: "https://app.sendgrid.com/settings/api_keys" },
  { match: /MAILGUN/, service: "Mailgun", powers: "Sending emails", howTo: "Mailgun → API Security.", link: "https://app.mailgun.com" },
  { match: /SLACK/, service: "Slack", powers: "Slack messages", howTo: "api.slack.com/apps → your app → OAuth & Permissions → Bot token.", link: "https://api.slack.com/apps" },
  { match: /DISCORD/, service: "Discord", powers: "Discord bot / webhooks", howTo: "discord.com/developers → your app → Bot → Token.", link: "https://discord.com/developers/applications" },
  { match: /TELEGRAM/, service: "Telegram", powers: "Telegram bot", howTo: "Message @BotFather on Telegram → /newbot → copy the token.", link: "https://t.me/BotFather" },
  { match: /FIREBASE/, service: "Firebase", powers: "Firebase app config", howTo: "Firebase console → Project settings → Your apps → config.", link: "https://console.firebase.google.com" },
  { match: /CLERK/, service: "Clerk", powers: "User login", howTo: "dashboard.clerk.com → API Keys.", link: "https://dashboard.clerk.com" },
  { match: /MAPBOX/, service: "Mapbox", powers: "Maps", howTo: "account.mapbox.com → Access tokens.", link: "https://account.mapbox.com/access-tokens" },
  { match: /GOOGLE_MAPS/, service: "Google Maps", powers: "Maps", howTo: "Google Cloud console → APIs & Services → Credentials.", link: "https://console.cloud.google.com/apis/credentials" },
  { match: /WALLETCONNECT|REOWN/, service: "WalletConnect", powers: "Crypto wallet connections", howTo: "cloud.reown.com → create project → Project ID.", link: "https://cloud.reown.com" },
  { match: /ALCHEMY/, service: "Alchemy", powers: "Blockchain data", howTo: "dashboard.alchemy.com → Apps → API key.", link: "https://dashboard.alchemy.com" },
  { match: /INFURA/, service: "Infura", powers: "Blockchain data", howTo: "infura.io dashboard → API keys.", link: "https://app.infura.io" },
  { match: /COINGECKO/, service: "CoinGecko", powers: "Crypto prices (optional key)", howTo: "coingecko.com → Developer dashboard → API key.", link: "https://www.coingecko.com/en/developers/dashboard" },
  { match: /CLOUDINARY/, service: "Cloudinary", powers: "Image hosting", howTo: "Cloudinary console → Dashboard → API keys.", link: "https://console.cloudinary.com" },
  { match: /PAYSTACK/, service: "Paystack", powers: "Payments (Africa)", howTo: "Paystack dashboard → Settings → API Keys.", link: "https://dashboard.paystack.com/#/settings/developers" },
  { match: /FLUTTERWAVE/, service: "Flutterwave", powers: "Payments (Africa)", howTo: "Flutterwave dashboard → Settings → API.", link: "https://dashboard.flutterwave.com" },
  { match: /TAVILY/, service: "Tavily", powers: "Web search", howTo: "app.tavily.com → API keys.", link: "https://app.tavily.com" },
  { match: /GITHUB/, service: "GitHub", powers: "GitHub access", howTo: "github.com → Settings → Developer settings → Personal access tokens.", link: "https://github.com/settings/tokens" },
];

const IGNORE = new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL", "PORT", "HOST", "CI", "VERCEL", "PWD", "HOME", "PATH"]);
const SCAN_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|html|json|toml|ya?ml)$|(^|\/)\.env[^/]*$/i;

export const CLIENT_PREFIX = /^(VITE_|NEXT_PUBLIC_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)/;

function describe(key: string): Omit<DetectedEnv, "key" | "foundIn" | "clientSide"> {
  const hit = CATALOG.find((c) => c.match.test(key));
  if (hit) return { service: hit.service, powers: hit.powers, howTo: hit.howTo, link: hit.link };
  return {
    service: "Custom",
    powers: "A setting your code reads",
    howTo: "Check the repo README or the service this name refers to. If unsure, leave it empty — the preview uses a safe placeholder.",
  };
}

export function scanEnvKeys(files: { path: string; content: string }[]): DetectedEnv[] {
  const map = new Map<string, DetectedEnv>();
  const add = (key: string, path: string, example?: string) => {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(key) || IGNORE.has(key)) return;
    const cur = map.get(key);
    if (cur) {
      if (!cur.foundIn.includes(path) && cur.foundIn.length < 5) cur.foundIn.push(path);
      if (example && !cur.exampleValue) cur.exampleValue = example;
      return;
    }
    map.set(key, { key, ...describe(key), clientSide: CLIENT_PREFIX.test(key), foundIn: [path], exampleValue: example });
  };

  for (const f of files) {
    const path = f.path.replace(/^\/+/, "");
    if (!SCAN_EXT.test(path) || /(^|\/)node_modules\//.test(path) || path === "package-lock.json") continue;
    const text = f.content || "";
    if (/(^|\/)\.env[^/]*$/i.test(path)) {
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        const raw = m[2].trim().replace(/^["']|["']$/g, "");
        // Only keep obviously non-secret example values (placeholders) as hints.
        const example = /your|xxx|example|<|placeholder|changeme/i.test(raw) ? raw.slice(0, 60) : undefined;
        add(m[1], path, example);
      }
      continue;
    }
    const patterns = [
      /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
      /import\.meta\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
      /Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g,
      /\$env\/static\/(?:public|private)[^;]*\{([^}]+)\}/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (re.source.startsWith("\\$env")) m[1].split(",").forEach((k) => add(k.trim(), path));
        else add(m[1], path);
      }
    }
  }
  const order = (d: DetectedEnv) => (d.service === "Custom" ? 1 : 0);
  return [...map.values()].sort((a, b) => order(a) - order(b) || a.service.localeCompare(b.service) || a.key.localeCompare(b.key));
}
