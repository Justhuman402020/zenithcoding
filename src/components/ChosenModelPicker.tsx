import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Layers, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { deleteChosenModel, listChosenModels, setChatChosenModel } from "@/lib/assistant.functions";

/** Side-chat model list: switch the chat's chosen model, or delete a saved one. */
export function ChosenModelPicker({ chatId, currentId, onChanged }: { chatId: string; currentId: string | null; onChanged: () => void }) {
  const load = useServerFn(listChosenModels);
  const setModel = useServerFn(setChatChosenModel);
  const del = useServerFn(deleteChosenModel);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listChosenModels>>>([]);
  useEffect(() => { if (open) void load().then(setRows).catch(() => {}); }, [open]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button size="icon" variant="ghost" className="rounded-full shrink-0" aria-label="Choose model" title="Choose model"><Layers className="h-4 w-4" /></Button></PopoverTrigger>
    <PopoverContent align="end" side="top" className="w-72 space-y-1 p-2">
      <div className="px-1 text-xs font-medium text-muted-foreground">Chosen models</div>
      {rows.length === 0 && <p className="px-1 text-xs text-muted-foreground">No saved models. Add them in Admin → AI Models.</p>}
      {rows.map((r) => <div key={r.id} className="flex items-center gap-1">
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={async () => { try { await setModel({ data: { chatId, chosenId: r.id } }); setOpen(false); onChanged(); } catch (e: any) { toast.error(e.message); } }}>
          {r.id === currentId ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="w-4 shrink-0" />}
          <span className="min-w-0 flex-1"><span className="block truncate">{r.model}</span><span className="block truncate text-xs text-muted-foreground">{r.key_label}</span></span>
        </button>
        <Button size="icon" variant="ghost" aria-label={`Delete ${r.model}`} onClick={async () => { await del({ data: { id: r.id } }); setRows((x) => x.filter((y) => y.id !== r.id)); if (r.id === currentId) onChanged(); }}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </PopoverContent>
  </Popover>;
}
