import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, MessageSquarePlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { listChosenModels, testAndChooseModel } from "@/lib/assistant.functions";

// One shared fetch of saved chat models for every row on the board.
let savedPromise: Promise<Set<string>> | null = null;
const savedKey = (provider: string, model: string) => `${provider}|${model}`;
function loadSaved(fetcher: () => Promise<Array<{ provider: string; key_ref: string; model: string }>>) {
  savedPromise ??= fetcher().then((rows) => new Set(rows.filter((r) => r.provider === "registry").map((r) => savedKey(r.key_ref, r.model)))).catch(() => new Set<string>());
  return savedPromise;
}

/** Tests the model; when it answers it is saved to the side chat model list. */
export function ChooseForChatButton({ provider, keyLabel, model, disabled }: { provider: string; keyLabel: string; model: string; disabled?: boolean }) {
  const list = useServerFn(listChosenModels);
  const choose = useServerFn(testAndChooseModel);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { void loadSaved(list).then((s) => setSaved(s.has(savedKey(provider, model)))); }, [provider, model]);
  if (saved) return <span className="inline-flex items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-3 w-3" />Good · Saved for chat</span>;
  return <div className="flex flex-col items-end gap-1">
    <Button size="sm" variant="outline" disabled={disabled || busy} onClick={async () => {
      setBusy(true); setFailed(null);
      try {
        const r = await choose({ data: { provider, keyLabel, model } });
        if (r.ok) { setSaved(true); savedPromise = null; toast.success(`${model} saved for chat`); }
        else { setFailed(r.error ?? "Not working. Choose another model."); toast.error(r.error ?? "Not working. Choose another model."); }
      } catch (e: any) { setFailed(e?.message ?? "Not working"); } finally { setBusy(false); }
    }}>{busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <MessageSquarePlus className="h-3 w-3 mr-1" />}{busy ? "Testing…" : "Choose for chat"}</Button>
    {failed && <span className="inline-flex max-w-56 items-start gap-1 text-right text-[11px] text-destructive"><XCircle className="h-3 w-3 shrink-0 mt-0.5" />{failed}</span>}
  </div>;
}
