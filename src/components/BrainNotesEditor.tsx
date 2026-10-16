import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, NotebookPen, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getBrainNotes, saveBrainNotes, type BrainNote } from "@/lib/admin-brain.functions";

const CATEGORIES = ["General", "Design", "Backend", "API keys", "Deploy", "Content", "Bugs"];

/** Expandable brain notes: category, what it's for, body, and a save icon per note. */
export function BrainNotesEditor() {
  const load = useServerFn(getBrainNotes);
  const persist = useServerFn(saveBrainNotes);
  const [saved, setSaved] = useState<BrainNote[] | null>(null);
  const [drafts, setDrafts] = useState<BrainNote[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load({}).then((r) => { setSaved(r.notes); setDrafts(r.notes); }).catch(() => { setSaved([]); setDrafts([]); });
  }, []);

  async function commit(next: BrainNote[], id: string) {
    setBusy(id);
    try {
      await persist({ data: { notes: next } });
      setSaved(next);
      toast.success("Note saved — the agent will follow it");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  function saveOne(id: string) {
    const draft = drafts.find((d) => d.id === id)!;
    const base = saved ?? [];
    const next = base.some((n) => n.id === id) ? base.map((n) => (n.id === id ? draft : n)) : [...base, draft];
    void commit(next, id);
  }

  function remove(id: string) {
    setDrafts((d) => d.filter((n) => n.id !== id));
    if ((saved ?? []).some((n) => n.id === id)) void commit((saved ?? []).filter((n) => n.id !== id), id);
  }

  const patch = (id: string, p: Partial<BrainNote>) => setDrafts((d) => d.map((n) => (n.id === id ? { ...n, ...p } : n)));

  if (!saved) return <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <section className="rounded-2xl border border-border bg-card/70 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl flex items-center gap-2"><NotebookPen className="h-5 w-5 text-primary" /> Brain notes</h2>
        <Button size="sm" className="gap-1" onClick={() => setDrafts((d) => [{ id: crypto.randomUUID(), category: "General", purpose: "", body: "" }, ...d])}>
          <Plus className="h-4 w-4" /> Add note
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Each note is added to every agent run. Tap the save icon on a note to store it.</p>
      {drafts.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
      {drafts.map((n) => {
        const original = saved.find((s) => s.id === n.id);
        const dirty = !original || original.category !== n.category || original.purpose !== n.purpose || original.body !== n.body;
        return (
          <details key={n.id} open={!original} className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
              <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[11px]">{n.category || "General"}</span>
              <span className="truncate">{n.purpose || "Untitled note"}</span>
              {dirty ? <span className="ml-auto text-[11px] text-muted-foreground">unsaved</span> : null}
            </summary>
            <div className="mt-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={n.category} onChange={(e) => patch(n.id, { category: e.target.value })} aria-label="Category">
                  {[...new Set([...CATEGORIES, n.category])].map((c) => <option key={c}>{c}</option>)}
                </select>
                <Input value={n.purpose} onChange={(e) => patch(n.id, { purpose: e.target.value })} placeholder="What it's for" />
              </div>
              <Textarea rows={5} value={n.body} onChange={(e) => patch(n.id, { body: e.target.value })} placeholder="Write the note…" className="text-sm" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!dirty || busy === n.id} onClick={() => saveOne(n.id)} className="gap-1">
                  {busy === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive gap-1" onClick={() => remove(n.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}
