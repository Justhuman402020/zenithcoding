import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { deleteChosenModel, listChosenModels, listOllamaKeys, setChatChosenModel, setupChat } from "@/lib/assistant.functions";
import { isCurrentPanelModel, panelModelsFor, type ChatEngine, type PanelModel } from "@/lib/chosen-models";

type ChatRef = { id: string; chosenModelId: string | null; keyId: string | null; model: string | null };

/** Right-hand side-chat list: only the models of the mode in charge (Chosen models or Ollama activated). */
export function ChatModelsPanel({ engine, chat, onChanged, onPicked }: { engine: ChatEngine; chat: ChatRef; onChanged: () => void; onPicked?: () => void }) {
  const loadChosen = useServerFn(listChosenModels);
  const loadOllama = useServerFn(listOllamaKeys);
  const pickChosen = useServerFn(setChatChosenModel);
  const pickOllama = useServerFn(setupChat);
  const del = useServerFn(deleteChosenModel);
  const [rows, setRows] = useState<PanelModel[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    (async () => {
      try {
        const next = engine === "chosen" ? panelModelsFor(engine, await loadChosen(), []) : engine === "ollama" ? panelModelsFor(engine, [], await loadOllama()) : [];
        if (live) setRows(next);
      } catch { if (live) setRows([]); }
    })();
    return () => { live = false; };
  }, [engine]);

  async function pick(r: PanelModel) {
    if (switching || isCurrentPanelModel(r, chat)) { onPicked?.(); return; }
    setSwitching(r.id);
    try {
      if (r.source === "chosen") await pickChosen({ data: { chatId: chat.id, chosenId: r.id } });
      else await pickOllama({ data: { id: chat.id, keyId: r.keyId!, model: r.model, initialize: true } });
      onChanged(); onPicked?.();
    } catch (e: any) { toast.error(e?.message ?? "Could not switch model"); }
    finally { setSwitching(null); }
  }

  const title = engine === "chosen" ? "Chosen models" : "Ollama models";
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 px-3 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
      {rows === null && <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
      {rows?.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">
        {engine === "chosen" ? "No saved models yet. Tap Choose for chat on a model in " : "No activated models yet. Tap Activate on a key in "}
        <Link to="/admin/models" className="text-primary underline">Admin → AI Models</Link>.
      </p>}
      {rows?.map((r, i) => {
        const newGroup = i === 0 || rows[i - 1].groupId !== r.groupId;
        const current = isCurrentPanelModel(r, chat);
        return <div key={r.id}>
          {newGroup && <div className={`px-2 pb-1 text-xs font-semibold break-words ${i === 0 ? "pt-1" : "mt-2 border-t pt-2"}`}>{r.groupLabel}</div>}
          <div className={`flex items-center gap-1 rounded-md ${current ? "bg-accent" : ""}`}>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent" aria-current={current || undefined} disabled={!!switching} onClick={() => void pick(r)}>
              {switching === r.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : current ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="w-4 shrink-0" />}
              <span className="min-w-0 flex-1 break-all">{r.model}</span>
            </button>
            {r.source === "chosen" && <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Delete ${r.model}`} title="Delete from chat models" onClick={async () => {
              try { await del({ data: { id: r.id } }); setRows((x) => (x ?? []).filter((y) => y.id !== r.id)); if (current) onChanged(); } catch (e: any) { toast.error(e?.message ?? "Could not delete"); }
            }}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
