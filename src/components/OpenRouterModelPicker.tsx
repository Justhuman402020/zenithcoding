import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Loader2, Search, Sparkles, Star } from "lucide-react";
import { listOpenRouterModels } from "@/lib/models-panel.functions";
import { MODEL_STORAGE_KEY, modelKey, readStoredModelRef } from "@/lib/ai-providers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Quota = {
  label: string;
  usage: number | null;
  limit: number | null;
  remaining: number | null;
  note: string | null;
};

type Model = {
  id: string;
  label: string;
  hint: string;
  vision: boolean;
  tools: boolean;
  curated: boolean;
};

function money(v: number | null | undefined) {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

export function OpenRouterModelPicker() {
  const fetchModels = useServerFn(listOpenRouterModels);
  const { data, isLoading } = useQuery({
    queryKey: ["openrouter-models"],
    queryFn: () => fetchModels(),
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    const ref = readStoredModelRef();
    setSelected(ref ? modelKey(ref) : "");
  }, []);

  const models = useMemo<Model[]>(() => (data?.models ?? []) as Model[], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [models, search]);

  function choose(modelId: string) {
    const key = modelKey({ provider: "openrouter", model: modelId });
    window.localStorage.setItem(MODEL_STORAGE_KEY, key);
    setSelected(key);
    toast.success(`AI model set to ${modelId}`);
  }

  function useAutomatic() {
    window.localStorage.removeItem(MODEL_STORAGE_KEY);
    setSelected("");
    toast.success("Using the admin's active model");
  }

  return (
    <div className="space-y-3">
      {/* Credit usage */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading OpenRouter…
        </div>
      ) : data && !data.keyConfigured ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          No OpenRouter API key is configured on the server yet. Add it to the app's secrets and reopen this panel.
        </div>
      ) : data?.quota ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Used</span>
            <span className="font-medium text-foreground">{money(data.quota.usage)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-medium text-primary">{money(data.quota.remaining)}</span>
          </div>
          {data.quota.limit != null && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gold-gradient"
                style={{
                  width: `${Math.min(100, Math.max(0, (data.quota.usage! / data.quota.limit!) * 100))}%`,
                }}
              />
            </div>
          )}
          {data.quota.note && <p className="text-[11px] italic text-muted-foreground">{data.quota.note}</p>}
        </div>
      ) : null}

      {/* Automatic option */}
      <button
        type="button"
        onClick={useAutomatic}
        className={cn(
          "w-full rounded-lg border px-3 py-2.5 text-left transition",
          selected === "" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Automatic (admin's choice)
        </span>
        <span className="block text-xs text-muted-foreground">Forge picks a working model for you.</span>
      </button>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${models.length || "all"} models… (deepseek, claude, gemini)`}
          className="h-9 pl-8 text-xs"
        />
      </div>

      {/* Model list */}
      <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border divide-y divide-border/60">
        {filtered.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No models match “{search}”.</div>
        ) : (
          filtered.map((m) => {
            const key = modelKey({ provider: "openrouter", model: m.id });
            const active = key === selected;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => choose(m.id)}
                className={cn(
                  "w-full flex items-start justify-between gap-2 px-3 py-2 text-left transition",
                  active ? "bg-primary/10" : "hover:bg-muted/40",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs font-medium text-foreground">{m.id}</span>
                  <span className="flex flex-wrap items-center gap-1.5 mt-1">
                    {m.id.endsWith(":free") && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">FREE</span>
                    )}
                    {m.vision && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Eye className="h-2.5 w-2.5" /> vision
                      </span>
                    )}
                    {m.curated && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        <Star className="h-2.5 w-2.5" /> pick
                      </span>
                    )}
                  </span>
                </span>
                {active && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary">Active</span>}
              </button>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {filtered.length} of {models.length} OpenRouter models shown. The model you pick is used for coding in every
        project; if it fails or runs dry, Forge falls back automatically.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs"
        onClick={() => setSearch("")}
        style={{ display: search ? undefined : "none" }}
      >
        Clear search
      </Button>
    </div>
  );
}
