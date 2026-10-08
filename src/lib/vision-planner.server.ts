import type { UIMessage } from "ai";
import type { ModelRef, ProviderOption } from "./ai-providers";
import type { ProviderKeys } from "./model-router.server";

export type VisionPlanResult = { brief: string; ref: ModelRef; failed: ModelRef[] };

function imageUrls(messages: UIMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  return (latest?.parts ?? []).flatMap((part: any) => {
    if ((part?.type === "file" || part?.type === "image") && typeof part?.mediaType === "string" && part.mediaType.startsWith("image/")) {
      const url = part.url ?? part.data ?? part.image;
      return typeof url === "string" ? [url] : [];
    }
    return [];
  });
}

const PLANNER_PROMPT = `You are a visual UI planner, not a coding agent. Inspect the supplied image carefully and return a compact implementation brief under 450 words with these exact headings: Layout, Styling, Text, Components, Responsive. Include visible wording, hierarchy, spacing, colors, typography, icons, borders, and structure. Do not write code and do not claim details you cannot see.`;

export async function planAttachedImages(args: {
  messages: UIMessage[];
  providers: ProviderOption[];
  keys: ProviderKeys;
  preferred: ModelRef | null;
  gateway: { url: string | null; enabled: boolean };
  onSwitch?: (seconds: number, failed: ModelRef) => Promise<void> | void;
}): Promise<VisionPlanResult | null> {
  const urls = imageUrls(args.messages);
  if (!urls.length) return null;
  const { listProviderModels } = await import("./model-discovery.server");
  const { gatewayBaseURL } = await import("./model-router.server");
  const candidates: ModelRef[] = [];
  if (args.preferred) candidates.push(args.preferred);
  for (const provider of args.providers) {
    const key = args.keys[provider.id];
    if (!key) continue;
    const models = await listProviderModels(provider.id, key, provider);
    for (const model of models.filter((item) => item.vision)) {
      if (!candidates.some((ref) => ref.provider === provider.id && ref.model === model.id)) candidates.push({ provider: provider.id, model: model.id });
    }
  }
  const failed: ModelRef[] = [];
  for (const ref of candidates) {
    const provider = args.providers.find((item) => item.id === ref.provider);
    const apiKey = args.keys[ref.provider];
    if (!provider || !apiKey) continue;
    const baseURL = gatewayBaseURL(args.gateway, ref.provider, provider.baseURL);
    try {
      const send = () => fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(/models\.github\.ai/i.test(baseURL) ? { "User-Agent": "CodeHaven/1.0" } : {}) },
        body: JSON.stringify({
          model: ref.model,
          messages: [{ role: "user", content: [{ type: "text", text: PLANNER_PROMPT }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))] }],
          max_tokens: 1800,
          stream: false,
        }),
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
      const brief = String(json?.choices?.[0]?.message?.content ?? "").trim();
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
