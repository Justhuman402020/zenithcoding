export type RouterModel = {
  id: string;
  label: string;
  vision: boolean;
  description: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  pricing: Record<string, string>;
  supportedParameters: string[];
  topProvider: { context_length?: number; max_completion_tokens?: number | null; is_moderated?: boolean };
  details: Record<string, unknown>;
};

export function catalogModels(data: Array<Record<string, any>>): RouterModel[] {
  return data.map((m) => {
    const inputModalities = m.architecture?.input_modalities ?? [];
    return {
      id: m.id, label: m.name ?? m.id, vision: inputModalities.includes("image"),
      description: m.description ?? "", contextLength: m.context_length ?? null,
      inputModalities, outputModalities: m.architecture?.output_modalities ?? [],
      pricing: m.pricing ?? {}, supportedParameters: m.supported_parameters ?? [],
      topProvider: m.top_provider ?? {}, details: m,
    };
  });
}

// Filtering preserves OpenRouter's catalog order and exact model identifiers.
export function searchRouterModels(models: RouterModel[], query: string, visionOnly = false) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => (!visionOnly || m.vision) && words.every((word) => `${m.label} ${m.id} ${m.description}`.toLowerCase().includes(word)));
}

export function tokenPrice(value?: string) {
  if (value === undefined || !Number.isFinite(Number(value))) return "Not provided";
  return `$${(Number(value) * 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 4 })} / 1M tokens`;
}

export function routerPriceLabel(pricing: Record<string, string>): "Free" | "Paid" | "Pricing unavailable" {
  const values = Object.values(pricing);
  if (values.some((v) => Number.isFinite(Number(v)) && Number(v) > 0)) return "Paid";
  if (pricing.prompt === undefined || pricing.completion === undefined || !values.length || values.some((v) => v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) !== 0)) return "Pricing unavailable";
  return "Free";
}