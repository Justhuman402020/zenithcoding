import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Search, Library, Loader2, ExternalLink, Info, FolderPlus, FolderKanban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { findScrolltideTemplates, readScrolltideTemplate, saveScrolltideDraft, scrolltideStatus } from "@/lib/scrolltide.functions";
import { SCROLLTIDE_ITEM_ALLOWANCE } from "@/lib/runtime-mcp/scrolltide-policy";
import { ScrolltidePreview } from "@/components/ScrolltidePreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/scrolltide")({
  head: () => ({
    meta: [
      { title: "Scrolltide library — Code Haven" },
      { name: "description", content: "Browse your Scrolltide template library and start a new project or update an existing one." },
      { property: "og:title", content: "Scrolltide library — Code Haven" },
      { property: "og:description", content: "Browse Scrolltide templates and use them in a new or existing project." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScrolltideLibraryPage,
});

type Item = { id: string; title: string; description: string; source: string; preview: string | null; poster?: string | null };
type Selected = { id: string; title: string; brief: string; source: string };

function ScrolltideLibraryPage() {
  const navigate = useNavigate();
  const search = useServerFn(findScrolltideTemplates);
  const read = useServerFn(readScrolltideTemplate);
  const save = useServerFn(saveScrolltideDraft);
  const status = useServerFn(scrolltideStatus);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [searched, setSearched] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [requirements, setRequirements] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  const scrollRoot = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const requestVersion = useRef(0);

  const find = useCallback(async (more = false, term = "") => {
    if (more && loading.current) return;
    const version = ++requestVersion.current;
    loading.current = true; setBusy(true); setNote(""); setPageError(false);
    if (!more) { setActiveQuery(term); setItems([]); setCursor(null); setSelected(null); setSearched(false); }
    try {
      const r = await search({ data: { query: term, cursor: more && cursor ? cursor : undefined } });
      if (version !== requestVersion.current) return;
      setItems(p => more ? [...p, ...r.items.filter(i => !p.some(x => x.id === i.id && x.source === i.source))] : r.items);
      setCursor(r.nextCursor === cursor && more ? null : r.nextCursor); setNote(r.note); setSearched(true);
    } catch (e) { if (version === requestVersion.current) { setPageError(true); setNote(e instanceof Error ? e.message : "Could not load templates."); } }
    finally { if (version === requestVersion.current) { loading.current = false; setBusy(false); } }
  }, [search, cursor]);
  const findRef = useRef(find); findRef.current = find;

  useEffect(() => {
    let cancelled = false;
    void status().then(r => {
      if (cancelled) return;
      setConnected(r.state === "ready");
      if (r.state === "ready") void findRef.current(false, "");
    }).catch(() => { if (!cancelled) { setConnected(false); setNote("Could not check Scrolltide connection."); } });
    return () => { cancelled = true; };
  }, [status]);

  useEffect(() => {
    if (selected || !cursor || busy || pageError || !loadMore.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void findRef.current(true, activeQuery); }, { root: scrollRoot.current, rootMargin: "240px" });
    observer.observe(loadMore.current);
    return () => observer.disconnect();
  }, [selected, cursor, busy, pageError, activeQuery]);

  async function details(id: string) {
    setBusy(true); setNote("");
    try { setSelected(await read({ data: { id } })); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not load template."); }
    finally { setBusy(false); }
  }

  async function openChooser() {
    setChooserOpen(true);
    if (projectsLoaded) return;
    const { data, error } = await supabase.from("projects").select("id,name").order("created_at", { ascending: false }).limit(50);
    if (error) toast.error("Could not load your projects.");
    setProjects(data ?? []);
    setProjectsLoaded(true);
  }

  async function saveAndOpen(projectId: string) {
    if (!selected) return;
    setBusy(true); setNote("");
    try {
      await save({ data: { projectId, templateId: selected.id, requirements } });
      setChooserOpen(false);
      navigate({ to: "/p/$projectId", params: { projectId }, search: { scrolltide: "1" } });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save the template draft.");
    } finally { setBusy(false); }
  }

  async function createNewProject() {
    if (!selected) return;
    setBusy(true); setNote("");
    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new Error("Please sign in again");
      const name = selected.title.replace(/[-_]+/g, " ").slice(0, 60) || "Scrolltide project";
      const { data: project, error } = await supabase.from("projects").insert({ name, description: `Created from the Scrolltide template "${selected.title}".`, user_id: userRes.user.id }).select("id").single();
      if (error || !project) throw error ?? new Error("Could not create the project.");
      await saveAndOpen(project.id);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not create the project.");
      setBusy(false);
    }
  }

  return (
    <div ref={scrollRoot} className="min-h-screen overflow-y-auto">
      <header className="h-14 flex items-center gap-2 px-3 border-b border-border sticky top-0 bg-background z-10">
        <Link to="/" aria-label="Back to home" className="p-2 text-muted-foreground hover:text-primary"><ArrowLeft className="h-5 w-5" /></Link>
        <Library className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg">Scrolltide library</h1>
      </header>
      <main className="mx-auto max-w-4xl p-4 space-y-4">
        <p className="text-xs text-muted-foreground">Yearly & Lifetime · Up to {SCROLLTIDE_ITEM_ALLOWANCE} different items per 24 hours, shared with Scrolltide.</p>
        {connected === false && (
          <div className="border border-border rounded-lg p-4 space-y-2">
            <p className="text-sm">Scrolltide isn't connected yet.</p>
            <Button asChild><Link to="/admin/integrations">Connect Scrolltide in Admin</Link></Button>
          </div>
        )}
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void find(false, query.trim()); }}>
          <Input aria-label="Search Scrolltide templates" placeholder="Search templates…" value={query} onChange={e => setQuery(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Search templates" disabled={busy || !connected}><Search className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" disabled={busy || !connected} onClick={() => { setQuery(""); void find(false, ""); }}>All</Button>
        </form>
        {note && <p role="status" className="text-sm whitespace-pre-wrap">{note}</p>}
        {selected ? (
          <div className="space-y-3">
            <Button variant="ghost" onClick={() => setSelected(null)}>Back to results</Button>
            <h2 className="font-semibold text-lg">{selected.title}</h2>
            <pre className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto bg-muted p-3 rounded-md">{selected.brief}</pre>
            <Textarea aria-label="Your template requirements" placeholder="Your brand, colors, sections to keep…" value={requirements} onChange={e => setRequirements(e.target.value)} />
            <div className="flex items-center gap-3 flex-wrap">
              <Button disabled={busy} onClick={() => void openChooser()}>Use template</Button>
              <a href={selected.source} target="_blank" rel="noopener noreferrer" className="inline-flex gap-1 text-sm text-primary">Open on Scrolltide<ExternalLink className="h-4 w-4" /></a>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(item => (
                <article key={`${item.source}:${item.id}`} className="border border-border rounded-lg p-3 space-y-2">
                  <ScrolltidePreview key={item.preview} title={item.title} preview={item.preview} poster={item.poster} source={item.source} />
                  <h3 className="font-semibold break-words">{item.title}</h3>
                  <p className="text-sm text-muted-foreground break-words">{item.description}</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void details(item.id)}><Info className="h-4 w-4" />Details</Button>
                    <Button size="sm" disabled={busy} onClick={() => void details(item.id)}>Use template</Button>
                    <a href={item.source} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} on Scrolltide`} className="p-2 text-primary"><ExternalLink className="h-4 w-4" /></a>
                  </div>
                </article>
              ))}
            </div>
            {searched && !busy && items.length === 0 && !note && <p className="text-sm text-muted-foreground">No templates found.</p>}
            {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading templates…</p>}
            <div ref={loadMore}>
              {cursor && <Button variant="outline" disabled={busy} onClick={() => void find(true, activeQuery)}>Load more</Button>}
              {pageError && !cursor && <Button variant="outline" disabled={busy} onClick={() => void find(false, activeQuery)}>Retry</Button>}
            </div>
          </>
        )}
      </main>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Use “{selected?.title}”</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Button className="w-full justify-start gap-2" disabled={busy} onClick={() => void createNewProject()}>
              <FolderPlus className="h-4 w-4" />Create new project
            </Button>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono">Or add to an existing project</div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {projects.length === 0 && <p className="text-sm text-muted-foreground">{projectsLoaded ? "No projects yet." : "Loading…"}</p>}
              {projects.map(p => (
                <button key={p.id} type="button" disabled={busy} onClick={() => void saveAndOpen(p.id)} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left hover:bg-accent truncate">
                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />{p.name}
                </button>
              ))}
            </div>
            {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Saving draft…</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
