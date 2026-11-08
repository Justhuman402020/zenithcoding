import type { UIMessage } from "ai";
import type { ModelRef, ProviderOption } from "./ai-providers";
import type { ProviderKeys } from "./model-router.server";
import { attachedImageUrls } from "./image-delivery";

export type VisionPlanResult = { brief: string; ref: ModelRef; failed: ModelRef[] };

const PLANNER_PROMPT = `You are a visual UI planner, not a coding agent. Inspect the supplied image carefully and return a compact implementation brief under 450 words with these exact headings: Layout, Styling, Text, Components, Responsive. Include visible wording, hierarchy, spacing, colors, typography, icons, borders, and structure. Do not write code and do not claim details you cannot see.`;

export async function planAttachedImages(args: {
  messages: UIMessage[];
  providers: ProviderOption[];
  keys: ProviderKeys;
  preferred: ModelRef | null;
  strict?: boolean;
  gateway: { url: string | null; enabled: boolean };
  onSwitch?: (seconds: number, failed: ModelRef) => Promise<void> | void;
}): Promise<VisionPlanResult | null> {
  const urls = attachedImageUrls(args.messages);
  if (!urls.length) return null;
  const { listProviderModels } = await import("./model-discovery.server");
  const { gatewayBaseURL } = await import("./model-router.server");
  // Cloudflare is never used for images, in any mode.
  const { withoutCloudflare } = await import("./cf-pool-routing");
  const providers = withoutCloudflare(args.providers);
  const allowed = new Set(providers.map((p) => p.id));
  const candidates: ModelRef[] = [];
  if (args.preferred && allowed.has(args.preferred.provider)) candidates.push(args.preferred);
  for (const provider of args.strict ? [] : providers) {
    const key = args.keys[provider.id];
    if (!key) continue;
    const models = await listProviderModels(provider.id, key, provider);
    for (const model of models.filter((item) => item.vision)) {
      if (!candidates.some((ref) => ref.provider === provider.id && ref.model === model.id)) candidates.push({ provider: provider.id, model: model.id });
    }
  }
  const failed: ModelRef[] = [];
  for (const ref of candidates) {
    const provider = providers.find((item) => item.id === ref.provider);
    const apiKey = args.keys[ref.provider];
    if (!provider || !apiKey) continue;
    const baseURL = gatewayBaseURL(args.gateway, ref.provider, provider.baseURL);
    const { isCloudflareBaseUrl } = await import("./cloudflare-pool.server");
    const cloudflare = isCloudflareBaseUrl(provider.baseURL);
    // Cloudflare Workers AI expects plain-text messages plus a top-level `image` data URI.
    const body = cloudflare
      ? { model: ref.model, messages: [{ role: "user", content: PLANNER_PROMPT }], image: urls[0], max_tokens: 1800, stream: false }
      : {
          model: ref.model,
          messages: [{ role: "user", content: [{ type: "text", text: PLANNER_PROMPT }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))] }],
          max_tokens: 1800,
          stream: false,
        };
    try {
      const send = () => fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(/models\.github\.ai/i.test(baseURL) ? { "User-Agent": "CodeHaven/1.0" } : {}) },
        body: JSON.stringify(body),
      });
      let response = await send();
      // Meta Llama 3.2 Vision on Cloudflare needs a license "agree" first: do it and retry once.
      if (!response.ok && /api\.cloudflare\.com/i.test(provider.baseURL)) {
        const text = await response.clone().text().catch(() => "");
        const cf = await import("./cloudflare-pool.server");
        if (cf.isMetaLicenseError(text) && (await cf.agreeMetaLicense(provider.baseURL, apiKey)).ok) {
          await cf.recordMetaLicense(ref.provider);
          response = await send();
        }
      }
      const json: any = await response.json().catch(() => null);
      const brief = String(json?.choices?.[0]?.message?.content ?? json?.result?.response ?? "").trim();
      if (response.ok && brief.length > 80) return { brief, ref, failed };
    } catch {
      // Try the next saved vision key.
    }
    failed.push(ref);
    await args.onSwitch?.(3, ref);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}
