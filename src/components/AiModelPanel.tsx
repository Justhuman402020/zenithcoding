import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu } from "lucide-react";
import { PROVIDERS, MODEL_STORAGE_KEY, modelKey, readStoredModelRef } from "@/lib/ai-providers";

export function AiModelPanel() {
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    const ref = readStoredModelRef();
    setSelected(ref ? modelKey(ref) : "");
  }, []);

  function choose(key: string, label: string) {
    setSelected(key);
    window.localStorage.setItem(MODEL_STORAGE_KEY, key);
    toast.success(`AI model set to ${label}`);
  }

  function useAdminChoice() {
    setSelected("");
    window.localStorage.removeItem(MODEL_STORAGE_KEY);
    toast.success("Using the admin's active model");
  }

  return (
    <div className="rounded-xl border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">AI model</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Pick which model builds this project. If it runs out of free credit or gets rate limited, Forge automatically
        switches to the next working model across all connected providers.
      </p>

      <button
        type="button"
        onClick={useAdminChoice}
        className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition ${
          selected === "" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
        }`}
      >
        <span className="block font-medium">Automatic (admin's choice)</span>
        <span className="block text-xs text-muted-foreground">Recommended — always uses a model that works.</span>
      </button>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => (
          <div key={provider.id} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provider.label}</div>
            <div className="grid gap-2">
              {provider.models.map((model) => {
                const key = modelKey({ provider: provider.id, model: model.id });
                const active = key === selected;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(key, `${provider.label} · ${model.label}`)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
                      active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-medium">{model.label}</span>
                      <span className="block text-xs text-muted-foreground">{model.hint}</span>
                    </span>
                    {active ? <span className="text-xs font-medium text-primary">Active</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
