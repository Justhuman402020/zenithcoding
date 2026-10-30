import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, Library, Loader2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { findScrolltideTemplates, readScrolltideTemplate, saveScrolltideDraft, decideScrolltideDraft, scrolltideStatus } from "@/lib/scrolltide.functions";
import { requestApproval } from "@/components/BuildApprovalDialog";
import { SCROLLTIDE_ITEM_ALLOWANCE } from "@/lib/runtime-mcp/scrolltide-policy";

type Item = { id: string; title: string; description: string; source: string; preview: string | null };
export function ScrolltideTemplates({ projectId, disabled, onBuild, initialQuery = "", openRequested = 0 }: { projectId: string; disabled: boolean; onBuild: (draftId: string, title: string) => Promise<void>; initialQuery?: string; openRequested?: number }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(initialQuery); const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false); const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<{ id: string; title: string; brief: string; source: string } | null>(null); const [requirements, setRequirements] = useState("");
  const search = useServerFn(findScrolltideTemplates); const read = useServerFn(readScrolltideTemplate); const save = useServerFn(saveScrolltideDraft); const decide = useServerFn(decideScrolltideDraft); const status = useServerFn(scrolltideStatus);
  useEffect(() => { if (openRequested) { setOpen(true); setQuery(initialQuery); } }, [openRequested, initialQuery]);
  useEffect(() => { if (open) void status().then(r => setConnected(r.state === "ready")).catch(() => setNote("Could not check Scrolltide connection.")); }, [open, status]);
  async function find(more = false) { setBusy(true); setNote(""); try { const r = await search({ data: { query, cursor: more && cursor ? cursor : undefined } }); setItems(p => more ? [...p, ...r.items.filter(i => !p.some(x => x.id === i.id))] : r.items); setCursor(r.nextCursor); setNote(r.note); setSearched(true); } catch (e) { setNote(e instanceof Error ? e.message : "Search failed."); } finally { setBusy(false); } }
  async function details(id: string) { setBusy(true); setNote(""); try { setSelected(await read({ data: { id } })); } catch (e) { setNote(e instanceof Error ? e.message : "Could not load template."); } finally { setBusy(false); } }
  async function useTemplate() {
    if (!selected || disabled) return;
    setBusy(true); setNote("");
    try {
      const draft = await save({ data: { projectId, templateId: selected.id, requirements } });
      setOpen(false);
      const approved = await requestApproval("openrouter", `Apply ${draft.title} to this project using your selected OpenRouter model?`);
      await decide({ data: { id: draft.id, approve: approved } });
      if (approved) await onBuild(draft.id, draft.title);
    } catch (e) { setOpen(true); setNote(e instanceof Error ? e.message : "Could not use template."); } finally { setBusy(false); }
  }
  return <><Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Scrolltide templates" title="Scrolltide templates" onClick={() => setOpen(true)}><Library className="h-4 w-4" /></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-3xl w-[calc(100%-1rem)] max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Scrolltide templates</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">Yearly & Lifetime · Up to {SCROLLTIDE_ITEM_ALLOWANCE} different items per 24 hours, shared with Scrolltide.</p>
      {!connected && <a href="/admin/integrations" className="text-primary underline">Connect Scrolltide in Admin</a>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void find(); }}><Input aria-label="Search Scrolltide templates" placeholder="Portfolio, product hero, pricing…" value={query} onChange={e => setQuery(e.target.value)} /><Button type="submit" size="icon" aria-label="Search templates" disabled={busy || !query.trim() || !connected}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></form>
      {note && <p role="status" className="text-sm whitespace-pre-wrap">{note}</p>}
      {selected ? <div className="space-y-3"><Button variant="ghost" onClick={() => setSelected(null)}>Back to results</Button><h3 className="font-semibold text-lg">{selected.title}</h3><pre className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto bg-muted p-3 rounded-md">{selected.brief}</pre><Textarea aria-label="Your template requirements" placeholder="Your brand, colors, sections to keep…" value={requirements} onChange={e => setRequirements(e.target.value)} /><Button disabled={busy || disabled} onClick={() => void useTemplate()}>Use template</Button><a href={selected.source} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 text-sm text-primary ml-3">Open on Scrolltide<ExternalLink className="h-4 w-4" /></a></div> : <>
        <div className="grid gap-3 sm:grid-cols-2">{items.map(item => <article key={item.id} className="border border-border rounded-lg p-3 space-y-2">{item.preview && <img src={item.preview} alt={item.title} className="aspect-video w-full object-contain bg-muted rounded-md" loading="lazy" referrerPolicy="no-referrer" />}<h3 className="font-semibold break-words">{item.title}</h3><p className="text-sm text-muted-foreground break-words">{item.description}</p><div className="flex gap-2 flex-wrap"><Button variant="outline" size="sm" disabled={busy} onClick={() => void details(item.id)}><Info className="h-4 w-4" />Details</Button><Button size="sm" disabled={busy} onClick={() => void details(item.id)}>Use template</Button><a href={item.source} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} on Scrolltide`} className="p-2 text-primary"><ExternalLink className="h-4 w-4" /></a></div></article>)}</div>
        {searched && !busy && items.length === 0 && !note && <p className="text-sm text-muted-foreground">No templates found.</p>}{cursor && <Button variant="outline" disabled={busy} onClick={() => void find(true)}>Load more</Button>}
      </>}
    </DialogContent></Dialog></>;
}