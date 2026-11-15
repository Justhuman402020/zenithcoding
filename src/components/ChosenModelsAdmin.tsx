import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ChevronDown, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { deleteChosenModel, listChatKeys, listChosenModels, listKeyModels, saveChosenModel, testChatModel } from "@/lib/assistant.functions";

type Key = Awaited<ReturnType<typeof listChatKeys>>[number];
type Result = { ok: boolean; error: string | null };

export function ChosenModelsAdmin() {
  const loadKeys = useServerFn(listChatKeys);
  const loadChosen = useServerFn(listChosenModels);
  const del = useServerFn(deleteChosenModel);
  const [keys, setKeys] = useState<Key[]>([]);
  const [chosen, setChosen] = useState<Awaited<ReturnType<typeof listChosenModels>>>([]);
  const refresh = () => loadChosen().then(setChosen).catch(() => {});
  useEffect(() => { void loadKeys().then(setKeys).catch(() => {}); void refresh(); }, []);
  return <section className="space-y-4 border-b py-5">
    <h2 className="font-semibold">Chosen models for side chat</h2>
    <p className="text-xs text-muted-foreground">Used when Chat helper is set to "Chosen models". Test a model, then save it for chat.</p>
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Chosen for chat ({chosen.length})</h3>
      {chosen.length === 0 && <p className="text-xs text-muted-foreground">None saved yet.</p>}
      {chosen.map((c) => <div key={c.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /><span className="min-w-0 flex-1 truncate">{c.model}</span><span className="hidden sm:inline truncate text-xs text-muted-foreground">{c.key_label}</span>
        <Button size="icon" variant="ghost" aria-label={`Delete ${c.model}`} onClick={async () => { await del({ data: { id: c.id } }); void refresh(); }}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </div>
    <div className="space-y-2">{keys.map((k) => <KeyModels key={`${k.provider}:${k.keyRef}`} k={k} saved={new Set(chosen.filter((c) => c.provider === k.provider && c.key_ref === k.keyRef).map((c) => c.model))} onSaved={refresh} />)}
      {keys.length === 0 && <p className="text-xs text-muted-foreground">No saved Ollama or OpenRouter keys found.</p>}</div>
  </section>;
}

function KeyModels({ k, saved, onSaved }: { k: Key; saved: Set<string>; onSaved: () => void }) {
  const list = useServerFn(listKeyModels);
  const test = useServerFn(testChatModel);
  const save = useServerFn(saveChosenModel);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  async function toggle() {
    setOpen(!open);
    if (!models) { const r = await list({ data: { provider: k.provider, keyRef: k.keyRef } }); setModels(r.models); setError(r.error); }
  }
  const shown = (models ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  return <div className="rounded-md border">
    <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" onClick={() => void toggle()}><ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />{k.label}{models && <span className="text-xs text-muted-foreground">· {models.length} models</span>}</button>
    {open && <div className="space-y-1 border-t p-2">
      {!models && <Loader2 className="h-4 w-4 animate-spin" />}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {models && models.length > 20 && <input className="w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="Search models" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {shown.map((m) => { const r = results[m]; return <div key={m} className="flex flex-wrap items-center gap-2 py-1 text-sm">
        <span className="min-w-0 flex-1 break-all">{m}</span>
        {r?.ok && <span className="inline-flex items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-3 w-3" />Good</span>}
        {r && !r.ok && <span className="inline-flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" />Not working: choose another model</span>}
        <Button size="sm" variant="outline" disabled={!!testing} onClick={async () => { setTesting(m); try { const res = await test({ data: { provider: k.provider, keyRef: k.keyRef, model: m } }); setResults((x) => ({ ...x, [m]: res })); if (!res.ok) toast.error(res.error ?? "Not working"); } finally { setTesting(null); } }}>{testing === m ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}</Button>
        {saved.has(m) ? <span className="text-xs text-muted-foreground">Saved</span> : r?.ok && <Button size="sm" onClick={async () => { await save({ data: { provider: k.provider, keyRef: k.keyRef, keyLabel: k.label, model: m } }); toast.success("Saved for chat"); onSaved(); }}><Plus className="h-3 w-3 mr-1" />Save for chat</Button>}
        {r && !r.ok && r.error && <p className="w-full text-xs text-muted-foreground">{r.error}</p>}
      </div>; })}
    </div>}
  </div>;
}
