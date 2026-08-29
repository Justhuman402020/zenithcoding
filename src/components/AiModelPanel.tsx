import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cpu } from "lucide-react";
import { GROQ_MODELS, GROQ_MODEL_STORAGE_KEY, readStoredGroqModel } from "@/lib/ai-models";

export function AiModelPanel() {
  const [model, setModel] = useState<string>(GROQ_MODELS[0].id);

  useEffect(() => {
    setModel(readStoredGroqModel());
  }, []);

  function choose(id: string) {
    setModel(id);
    window.localStorage.setItem(GROQ_MODEL_STORAGE_KEY, id);
    toast.success(`AI model set to ${GROQ_MODELS.find((m) => m.id === id)?.label ?? id}`);
  }

  return (
    <div className="rounded-xl border p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">AI model</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Pick which Groq model builds your project. If it runs out of free credit or gets rate limited, Forge
        automatically switches to the next one in this list for you.
      </p>
      <div className="grid gap-2">
        {GROQ_MODELS.map((option) => {
          const active = option.id === model;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
                active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              }`}
            >
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
              {active ? <span className="text-xs font-medium text-primary">Active</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
