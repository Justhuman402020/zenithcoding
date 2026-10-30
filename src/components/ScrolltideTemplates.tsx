import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, Library, Loader2, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { findScrolltideTemplates, readScrolltideTemplate, saveScrolltideDraft, decideScrolltideDraft, scrolltideStatus, listScrolltideDrafts } from "@/lib/scrolltide.functions";
import { requestApproval } from "@/components/BuildApprovalDialog";
import { SCROLLTIDE_ITEM_ALLOWANCE } from "@/lib/runtime-mcp/scrolltide-policy";
import { ScrolltidePreview } from "@/components/ScrolltidePreview";

type Item = { id: string; title: string; description: string; source: string; preview: string | null };
export function ScrolltideTemplates({ projectId, disabled, onBuild, initialQuery = "", openRequested = 0 }: { projectId: string; disabled: boolean; onBuild: (draftId: string, title: string) => Promise<void>; initialQuery?: string; openRequested?: number }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(initialQuery); const [items, setItems] = useState<Item[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false); const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<{ id: string; title: string; brief: string; source: string } | null>(null); const [requirements, setRequirements] = useState("");
  const search = useServerFn(findScrolltideTemplates); const read = useServerFn(readScrolltideTemplate); const save = useServerFn(saveScrolltideDraft); const decide = useServerFn(decideScrolltideDraft); const status = useServerFn(scrolltideStatus);
  const loadDrafts = useServerFn(listScrolltideDrafts);
  const [drafts, setDrafts] = useState<Array<{ id: string; title: string; state: string }>>([]);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const requestVersion = useRef(0);
  const [activeQuery, setActiveQuery] = useState("");
  const [pageError, setPageError] = useState(false);
  useEffect(() => { if (open) void loadDrafts({ data: { projectId } }).then(setDrafts).catch(() => setNote("Could not load saved drafts.")); }, [open, projectId, loadDrafts]);
  async function resumeDraft(id: string, title: string, state: string) {
    if (disabled || busy) return;
    setBusy(true); setOpen(false);
    try {
      const approved = await requestApproval("openrouter", `Apply ${title} to this project using your selected OpenRouter model?`);
      if (state === "draft") await decide({ data: { id, approve: approved } });
      if (approved) await onBuild(id, title);
    } catch (e) { setOpen(true); setNote(e instanceof Error ? e.message : "Could not start saved draft."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (openRequested) { setOpen(true); setQuery(initialQuery); } }, [openRequested, initialQuery]);
  const find = useCallback(async (more = false, term = "") => {
    if (more && loading.current) return;
    const version = ++requestVersion.current;
    loading.current = true; setBusy(true); setNote(""); setPageError(false);
    if (!more) { setActiveQuery(term); setItems([]); setCursor(null); setSelected(null); setSearched(false); }
    try {
      const r = await search({ data: { query: term, cursor: more && cursor ? cursor : undefined } });
      if (version !== requestVersion.current) return;
      setItems(p => more ? [...p, ...r.items.filter(i => !p.some(x => x.id === i.id))] : r.items);
      setCursor(r.nextCursor === cursor && more ? null : r.nextCursor); setNote(r.note); setSearched(true);
    } catch (e) { if (version === requestVersion.current) { setPageError(true); setNote(e instanceof Error ? e.message : "Could not load templates."); } }
    finally { if (version === requestVersion.current) { loading.current = false; setBusy(false); } }
  }, [search, cursor]);
  const findRef = useRef(find); findRef.current = find;
  useEffect(() => {
    if (!open) { ++requestVersion.current; loading.current = false; setBusy(false); return; }
    let cancelled = false;
    setSelected(null); setItems([]); setCursor(null); setSearched(false); setNote("");
    void status().then(r => { if (cancelled) return; setConnected(r.state === "ready"); if (r.state === "ready") void findRef.current(false, initialQuery); }).catch(() => { if (!cancelled) setNote("Could not check Scrolltide connection."); });
    return () => { cancelled = true; };
  }, [open, status, initialQuery, openRequested]);
  useEffect(() => {
    if (!open || selected || !cursor || busy || pageError || !loadMore.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void findRef.current(true, activeQuery); }, { root: scrollRoot.current, rootMargin: "240px" });
    observer.observe(loadMore.current);
    return () => observer.disconnect();
  }, [open, selected, cursor, busy, pageError, activeQuery]);
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
    <Dialog open={open} onOpenChange={setOpen}><DialogContent ref={scrollRoot} className="max-w-3xl w-[calc(100%-1rem)] max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Scrolltide templates</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">Yearly & Lifetime · Up to {SCROLLTIDE_ITEM_ALLOWANCE} different items per 24 hours, shared with Scrolltide.</p>
      {!connected && <a href="/admin/integrations" className="text-primary underline">Connect Scrolltide in Admin</a>}
      {drafts.length > 0 && <div className="space-y-2 border-b border-border pb-3"><h3 className="font-semibold">Saved drafts</h3>{drafts.map(d => <div key={d.id} className="flex gap-2 items-center"><span className="text-sm flex-1 min-w-0 break-words">{d.title}</span><Button size="sm" disabled={busy || disabled} onClick={() => void resumeDraft(d.id, d.title, d.state)}>Review approval</Button></div>)}</div>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void find(false, query.trim()); }}><Input aria-label="Search Scrolltide templates" placeholder="Search templates…" value={query} onChange={e => setQuery(e.target.value)} /><Button type="submit" size="icon" aria-label="Search templates" disabled={busy || !connected}><Search className="h-4 w-4" /></Button><Button type="button" variant="outline" disabled={busy || !connected} onClick={() => { setQuery(""); void find(false, ""); }}>All</Button></form>
      {note && <p role="status" className="text-sm whitespace-pre-wrap">{note}</p>}
      {selected ? <div className="space-y-3"><Button variant="ghost" onClick={() => setSelected(null)}>Back to results</Button><h3 className="font-semibold text-lg">{selected.title}</h3><pre className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto bg-muted p-3 rounded-md">{selected.brief}</pre><Textarea aria-label="Your template requirements" placeholder="Your brand, colors, sections to keep…" value={requirements} onChange={e => setRequirements(e.target.value)} /><Button disabled={busy || disabled} onClick={() => void useTemplate()}>Use template</Button><a href={selected.source} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 text-sm text-primary ml-3">Open on Scrolltide<ExternalLink className="h-4 w-4" /></a></div> : <>
        <div className="grid gap-3 sm:grid-cols-2">{items.map(item => <article key={`${item.source}:${item.id}`} className="border border-border rounded-lg p-3 space-y-2"><ScrolltidePreview key={item.preview} title={item.title} preview={item.preview} source={item.source} /><h3 className="font-semibold break-words">{item.title}</h3><p className="text-sm text-muted-foreground break-words">{item.description}</p><div className="flex gap-2 flex-wrap"><Button variant="outline" size="sm" disabled={busy} onClick={() => void details(item.id)}><Info className="h-4 w-4" />Details</Button><Button size="sm" disabled={busy} onClick={() => void details(item.id)}>Use template</Button><a href={item.source} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} on Scrolltide`} className="p-2 text-primary"><ExternalLink className="h-4 w-4" /></a></div></article>)}</div>
        {searched && !busy && items.length === 0 && !note && <p className="text-sm text-muted-foreground">No templates found.</p>}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading templates…</p>}
        <div ref={loadMore}>{cursor && <Button variant="outline" disabled={busy} onClick={() => void find(true, activeQuery)}>Load more</Button>}{pageError && !cursor && <Button variant="outline" disabled={busy} onClick={() => void find(false, activeQuery)}>Retry</Button>}</div>
      </>}
    </DialogContent></Dialog></>;
}