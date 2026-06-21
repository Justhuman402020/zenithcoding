import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2, Code2, LogOut, Globe, ExternalLink, Share2, PanelLeft, Home, FolderKanban, MessageSquare, ArrowUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Project = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  published: boolean;
  slug: string | null;
};

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Forge — your projects" }] }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,updated_at,published,slug")
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else setProjects(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: newName.trim(), description: newDesc.trim() || null, user_id: userRes.user.id })
      .select()
      .single();
    if (error) return toast.error(error.message);

    // seed an index.html
    await supabase.from("files").insert({
      project_id: data.id,
      user_id: userRes.user.id,
      path: "index.html",
      content: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${newName.trim()}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0f0c1a; color: #e8e3f5; }
    h1 { background: linear-gradient(135deg, #a78bfa, #c4b5fd); -webkit-background-clip: text; color: transparent; }
  </style>
</head>
<body>
  <div>
    <h1>${newName.trim()}</h1>
    <p>Ask the AI on the left to start building.</p>
  </div>
</body>
</html>`,
    });

    setOpen(false);
    setNewName("");
    setNewDesc("");
    navigate({ to: "/p/$projectId", params: { projectId: data.id } });
  }

  async function createFromPrompt(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) { setCreating(false); return; }
    const name = text.split(/\s+/).slice(0, 4).join(" ").slice(0, 60) || "Untitled";
    const { data, error } = await supabase
      .from("projects")
      .insert({ name, description: text.slice(0, 200), user_id: userRes.user.id })
      .select()
      .single();
    if (error) { setCreating(false); return toast.error(error.message); }
    await supabase.from("files").insert({
      project_id: data.id,
      user_id: userRes.user.id,
      path: "index.html",
      content: `<!doctype html><html><head><meta charset="utf-8"/><title>${name}</title></head><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f0c1a;color:#e8e3f5"><p>Building…</p></body></html>`,
    });
    setPrompt("");
    navigate({ to: "/p/$projectId", params: { projectId: data.id }, search: { prompt: text } as any });
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its files?")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setProjects((p) => p.filter((x) => x.id !== id));
  }

  function publicSiteUrl(slug: string) {
    if (typeof window === "undefined") return `/s/${slug}`;
    return `${window.location.origin}/s/${slug}`;
  }

  async function shareProject(slug: string) {
    try {
      await navigator.clipboard.writeText(publicSiteUrl(slug));
      toast.success("Public link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="h-14 flex items-center justify-between px-3 shrink-0">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Open menu">
              <PanelLeft className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
            <SheetHeader className="px-4 pt-4 pb-2">
              <SheetTitle className="flex items-center gap-2 text-base">
                <div className="h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </div>
                Forge
              </SheetTitle>
            </SheetHeader>
            <nav className="px-2 py-2 space-y-0.5">
              <SidebarItem icon={Home} label="Home" active onClick={() => setSidebarOpen(false)} />
              <SidebarItem icon={FolderKanban} label="Projects" onClick={() => { setSidebarOpen(false); document.getElementById("projects-grid")?.scrollIntoView({ behavior: "smooth" }); }} />
              <SidebarItem icon={MessageSquare} label="Chats" onClick={() => { setSidebarOpen(false); document.getElementById("projects-grid")?.scrollIntoView({ behavior: "smooth" }); }} />
            </nav>
            <div className="px-2 py-2 border-t border-sidebar-border mt-2 space-y-0.5">
              <SidebarItem icon={LogOut} label="Sign out" onClick={signOut} />
            </div>
            <div className="px-4 pt-4 pb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Recent</div>
            <div className="px-2 space-y-0.5 overflow-y-auto max-h-[40vh]">
              {projects.slice(0, 10).map((p) => (
                <Link
                  key={p.id}
                  to="/p/$projectId"
                  params={{ projectId: p.id }}
                  onClick={() => setSidebarOpen(false)}
                  className="block px-3 py-2 rounded-md text-sm truncate hover:bg-sidebar-accent"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-4 -mt-10">
        <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-center mb-6">
          What do you want to create?
        </h1>
        <form onSubmit={createFromPrompt} className="w-full max-w-2xl">
          <div className="rounded-2xl border border-border bg-card/60 backdrop-blur p-3 shadow-2xl">
            <Textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); createFromPrompt(e as any); } }}
              placeholder="Ask Forge to build…"
              rows={2}
              className="resize-none border-0 bg-transparent focus-visible:ring-0 text-base min-h-[60px] p-2"
            />
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                <Plus className="h-4 w-4" /> New blank project
              </button>
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 rounded-full"
                disabled={!prompt.trim() || creating}
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {["Landing page for a coffee shop", "Personal portfolio site", "Simple todo app"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setPrompt(s); promptRef.current?.focus(); }}
                className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                {s}
              </button>
            ))}
          </div>
        </form>
      </section>

      <main id="projects-grid" className="max-w-6xl w-full mx-auto px-4 pb-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Your projects</h2>
            <p className="text-xs text-muted-foreground mt-1">Tap a project to open it.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1.5" /> New
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New project</DialogTitle>
              </DialogHeader>
              <form onSubmit={createProject} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm">Name</label>
                  <Input autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-app" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm">Description (optional)</label>
                  <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What are you building?" />
                </div>
                <DialogFooter>
                  <Button type="submit">Create</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <Code2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium">No projects yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create your first one to start chatting with the AI.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <div key={p.id} className="group relative rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors">
                <Link to="/p/$projectId" params={{ projectId: p.id }} className="block">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{p.name}</h3>
                    {p.published && p.slug && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                        <Globe className="h-2.5 w-2.5" /> Live
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-[2.5rem]">{p.description || "No description"}</p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Edited {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                  </p>
                </Link>
                {p.published && p.slug && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <a
                      href={`/s/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline min-w-0"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">/s/{p.slug}</span>
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 px-2.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        shareProject(p.slug!);
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Share
                    </Button>
                  </div>
                )}
                <button
                  onClick={() => deleteProject(p.id)}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}