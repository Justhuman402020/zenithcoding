import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  getGithubAuthUrl,
  getGithubStatus,
  listGithubRepos,
  importGithubRepoAsProject,
  mirrorAllGithubRepos,
  disconnectGithub,
} from "@/lib/github.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Code2, LogOut, Globe, ExternalLink, Share2, PanelLeft, Home, FolderKanban, MessageSquare, ArrowUp, Github, Loader2, Check, Lock, Hammer, RefreshCw, CloudDownload } from "lucide-react";
import { X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ForgeMark } from "@/components/ForgeMark";

function SidebarItem({ icon: Icon, label, active, onClick }: { icon: any; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

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
  const [ghOpen, setGhOpen] = useState(false);
  const [ghUrl, setGhUrl] = useState("");
  const [ghImporting, setGhImporting] = useState(false);
  const [ghProgress, setGhProgress] = useState<string>("");
  const [ghConnected, setGhConnected] = useState<{ connected: boolean; login: string | null }>({ connected: false, login: null });
  const [ghRepos, setGhRepos] = useState<Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }>>([]);
  const [ghSelectedRepo, setGhSelectedRepo] = useState<string>("");
  const [ghBranch, setGhBranch] = useState("");
  const [ghSubpath, setGhSubpath] = useState("");
  const [ghLoadingRepos, setGhLoadingRepos] = useState(false);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [ghRepoError, setGhRepoError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const startGhAuth = useServerFn(getGithubAuthUrl);
  const fetchGhStatus = useServerFn(getGithubStatus);
  const fetchGhRepos = useServerFn(listGithubRepos);
  const importGhRepo = useServerFn(importGithubRepoAsProject);
  const mirrorRepos = useServerFn(mirrorAllGithubRepos);
  const disconnectGh = useServerFn(disconnectGithub);

  const [mirroring, setMirroring] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<{
    total: number;
    done: number;
    failed: { full_name: string; error: string }[];
  } | null>(null);

  const [helperDismissed, setHelperDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("forge-gh-helper-dismissed") === "1";
  });
  function dismissHelper() {
    setHelperDismissed(true);
    try { window.localStorage.setItem("forge-gh-helper-dismissed", "1"); } catch {}
  }

  async function handleMirrorAll() {
    if (mirroring) return;
    setMirroring(true);
    setMirrorStatus(null);
    const failed: { full_name: string; error: string }[] = [];
    let total = 0;
    let done = 0;
    try {
      // Loop: import in batches until the server reports remaining === 0.
      for (let i = 0; i < 50; i += 1) {
        const res: any = await mirrorRepos({ data: undefined });
        if (i === 0) {
          total = (res.total ?? 0) - (res.alreadyMirrored ?? 0);
          done = 0;
        }
        done += res.imported?.length ?? 0;
        if (res.failed?.length) failed.push(...res.failed);
        setMirrorStatus({
          total: total || (res.imported?.length ?? 0) + (res.remaining ?? 0),
          done,
          failed: [...failed],
        });
        if (!res.remaining) break;
      }
      await load();
      toast.success(
        `Mirrored ${done} repo${done === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed` : ""}`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Mirror failed");
    } finally {
      setMirroring(false);
    }
  }

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

  // Refresh GitHub status when the dashboard mounts and after the popup signals back
  useEffect(() => {
    fetchGhStatus({}).then(setGhConnected).catch(() => {});
    let lastLogin: string | null = null;
    const refresh = () => {
      fetchGhStatus({}).then((s) => {
        setGhConnected(s);
        if (s.connected) {
          setGhConnecting(false);
          if (s.login !== lastLogin) {
            lastLogin = s.login;
            toast.success(`GitHub connected${s.login ? ` as ${s.login}` : ""}`);
          }
        }
      }).catch(() => {});
    };
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "github-connected") refresh();
    }
    function onStorage(e: StorageEvent) {
      if (e.key === "forge-github-connected") refresh();
    }
    function onFocus() { refresh(); }
    function onVisibility() { if (document.visibilityState === "visible") refresh(); }
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("forge-github");
      bc.onmessage = (e) => { if (e.data?.type === "github-connected") refresh(); };
    } catch {}
    window.addEventListener("message", onMsg);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("message", onMsg);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      bc?.close();
    };
  }, []);

  async function loadRepos() {
    setGhLoadingRepos(true);
    setGhRepoError(null);
    try {
      const rs = await fetchGhRepos({});
      setGhRepos(rs);
      if (rs.length === 0) setGhRepoError("No repositories found on this GitHub account.");
    } catch (e: any) {
      const msg = e?.message || "Could not load repos";
      setGhRepoError(msg);
      toast.error(msg);
    } finally {
      setGhLoadingRepos(false);
    }
  }

  // Load repo list when dialog opens (if connected)
  useEffect(() => {
    if (!ghOpen || !ghConnected.connected) return;
    loadRepos();
  }, [ghOpen, ghConnected.connected]);

  // Auto-load repos on the page as soon as GitHub is connected
  useEffect(() => {
    if (!ghConnected.connected) return;
    if (ghRepos.length > 0 || ghLoadingRepos) return;
    loadRepos();
  }, [ghConnected.connected]);

  const [importingRepo, setImportingRepo] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  async function quickImportRepo(fullName: string, defaultBranch: string) {
    if (importingRepo) return;
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) return;
    setImportingRepo(fullName);
    try {
      const result = await importGhRepo({
        data: { owner, repo, branch: defaultBranch || undefined },
      });
      toast.success(`Imported ${result.fileCount} files from ${fullName}`);
      navigate({ to: "/p/$projectId", params: { projectId: result.projectId } });
    } catch (err: any) {
      toast.error(err?.message || "Import failed");
    } finally {
      setImportingRepo(null);
    }
  }

  async function connectGithub() {
    try {
      setGhConnecting(true);
      const { url } = await startGhAuth({ data: { origin: window.location.origin } });
      window.location.assign(url);
    } catch (e: any) {
      setGhConnecting(false);
      toast.error(e?.message || "Could not start GitHub auth");
    }
  }

  async function handleDisconnectGh() {
    await disconnectGh({});
    setGhConnected({ connected: false, login: null });
    setGhRepos([]);
    setGhSelectedRepo("");
    toast.success("Disconnected GitHub");
  }

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

  async function importFromGithub(e: React.FormEvent) {
    e.preventDefault();
    if (ghImporting) return;

    // Determine owner/repo/branch/subpath from either URL or selected repo
    let owner = "", repo = "", branch = ghBranch.trim(), subpath = ghSubpath.trim();
    const pastedRepoUrl = ghUrl.trim();
    if (ghSelectedRepo && !pastedRepoUrl) {
      const [o, r] = ghSelectedRepo.split("/");
      owner = o; repo = r;
      if (!branch) {
        const found = ghRepos.find((x) => x.full_name === ghSelectedRepo);
        branch = found?.default_branch || "";
      }
    } else {
      const raw = pastedRepoUrl;
      if (!raw) return toast.error("Pick a repo or paste a URL");
      try {
        const cleaned = raw
          .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
          .replace(/\.git$/, "")
          .replace(/\/$/, "");
        const parts = cleaned.split("/");
        owner = parts[0]; repo = parts[1];
        if (parts[2] === "tree" && parts[3]) {
          if (!branch) branch = parts[3];
          if (!subpath) subpath = parts.slice(4).join("/");
        }
        if (!owner || !repo) throw new Error("bad");
      } catch {
        return toast.error("Use https://github.com/owner/repo");
      }
    }

    setGhImporting(true);
    setGhProgress("Reading and saving repo…");
    try {
      const result = await importGhRepo({
        data: { owner, repo, branch: branch || undefined, subpath: subpath || undefined },
      });

      toast.success(`Imported ${result.fileCount} files from ${owner}/${repo}`);
      setGhOpen(false);
      setGhUrl(""); setGhSelectedRepo(""); setGhBranch(""); setGhSubpath("");
      navigate({ to: "/p/$projectId", params: { projectId: result.projectId } });
    } catch (err: any) {
      toast.error(err?.message || "Import failed");
    } finally {
      setGhImporting(false);
      setGhProgress("");
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 vignette" />
      <header className="h-14 flex items-center justify-between px-3 shrink-0 relative">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:text-primary" aria-label="Open menu">
              <PanelLeft className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
            <SheetHeader className="px-4 pt-4 pb-2">
              <SheetTitle className="flex items-center gap-2.5 text-base font-display">
                <ForgeMark className="h-7 w-7" glow />
                <span className="text-gold text-xl">Forge</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="px-2 py-2 space-y-0.5">
              <SidebarItem icon={Home} label="Home" active onClick={() => setSidebarOpen(false)} />
              <SidebarItem icon={FolderKanban} label="Projects" onClick={() => { setSidebarOpen(false); document.getElementById("projects-grid")?.scrollIntoView({ behavior: "smooth" }); }} />
              <SidebarItem icon={MessageSquare} label="Chats" onClick={() => { setSidebarOpen(false); document.getElementById("projects-grid")?.scrollIntoView({ behavior: "smooth" }); }} />
              <Link to="/templates" onClick={() => setSidebarOpen(false)} className="block w-full">
                <SidebarItem icon={FolderKanban} label="Templates" />
              </Link>
              <Link to="/account/billing" onClick={() => setSidebarOpen(false)} className="block w-full">
                <SidebarItem icon={Globe} label="Billing & credits" />
              </Link>
            </nav>
            <div className="px-2 py-2 border-t border-sidebar-border mt-2 space-y-0.5">
              <SidebarItem icon={LogOut} label="Sign out" onClick={signOut} />
            </div>
            <div className="px-4 pt-4 pb-2 text-[10px] uppercase tracking-[0.2em] text-primary/70 font-mono">Recent</div>
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
        <div className="flex items-center gap-2 md:hidden">
          <ForgeMark className="h-6 w-6" />
          <span className="font-display text-lg text-gold">Forge</span>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-primary">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>
      {ghConnected.connected && (
        <button
          type="button"
          onClick={handleMirrorAll}
          disabled={mirroring}
          aria-label="Import all my GitHub repos"
          title={
            mirroring && mirrorStatus
              ? `Importing ${mirrorStatus.done}/${mirrorStatus.total} repos…`
              : "One-tap: import every repo from your connected GitHub into Forge"
          }
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gold-gradient px-4 py-3 text-primary-foreground shadow-gold-glow hairline-gold transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-80"
        >
          {mirroring ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CloudDownload className="h-5 w-5" />
          )}
          <span className="text-xs font-medium">
            {mirroring && mirrorStatus
              ? `${mirrorStatus.done}/${mirrorStatus.total}`
              : "Import all my sites"}
          </span>
        </button>
      )}

      <section className="flex-1 flex flex-col items-center justify-center px-4 pt-6 pb-12 relative">
        <div className="hidden md:flex items-center gap-3 mb-8">
          <ForgeMark className="h-12 w-12" glow />
          <span className="font-display text-3xl text-gold">Forge</span>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-[0.32em] text-primary/60 mb-3">
          Pure Gold · Private Atelier
        </p>
        <h1 className="font-display text-4xl sm:text-6xl leading-[1.02] text-center mb-8 max-w-3xl">
          What will you <em className="text-gold not-italic">forge</em> today?
        </h1>
        <form onSubmit={createFromPrompt} className="w-full max-w-2xl">
          <div className="rounded-2xl hairline-gold bg-card/70 backdrop-blur-sm p-3 shadow-candlelight">
            <Textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); createFromPrompt(e as any); } }}
              placeholder="Describe what you want — a landing page, a portfolio, a tool…"
              rows={2}
              className="resize-none border-0 bg-transparent focus-visible:ring-0 text-base min-h-[64px] p-2 placeholder:text-muted-foreground/70"
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-accent/40"
                >
                  <Plus className="h-4 w-4" /> Blank
                </button>
                <button
                  type="button"
                  onClick={ghConnected.connected ? () => setGhOpen(true) : connectGithub}
                  disabled={ghConnecting}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-accent/40"
                >
                  {ghConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />} Import
                </button>
                {ghConnected.connected && (
                  <button
                    type="button"
                    onClick={handleMirrorAll}
                    disabled={mirroring}
                    title="Import every repo from your connected GitHub that isn't here yet"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-accent/40 disabled:opacity-60"
                  >
                    {mirroring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {mirroring && mirrorStatus
                      ? `Mirroring ${mirrorStatus.done}/${mirrorStatus.total}`
                      : "Mirror all"}
                  </button>
                )}
              </div>
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 rounded-full bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow"
                disabled={!prompt.trim() || creating}
                aria-label="Send"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5 justify-center">
            {[
              "An editorial portfolio in gold and noir",
              "A landing page for a luxury watch brand",
              "A reservation page for a private restaurant",
              "A boutique law firm site",
            ].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setPrompt(s); promptRef.current?.focus(); }}
                className="text-xs px-3.5 py-1.5 rounded-full hairline-gold text-muted-foreground hover:text-primary hover:bg-accent/30 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </form>
      </section>

      <main id="projects-grid" className="max-w-6xl w-full mx-auto px-4 pb-16 relative">
        {!helperDismissed && (
          <div className="mb-8 rounded-2xl hairline-gold bg-card/60 backdrop-blur-sm p-5 sm:p-6 relative shadow-candlelight">
            <button
              type="button"
              onClick={dismissHelper}
              aria-label="Dismiss"
              className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-accent/40"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 mb-1">
              <Github className="h-4 w-4 text-primary" />
              <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/70">
                Connect to GitHub
              </p>
            </div>
            <h3 className="font-display text-2xl mb-2">
              Bring every Lovable project here in 3 steps
            </h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Lovable doesn't expose a direct download API, but every Lovable project can push its code to GitHub with one click. Once a project is on GitHub, Forge mirrors it automatically.
            </p>

            <ol className="mt-5 space-y-4">
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-gold-gradient text-primary-foreground text-xs font-bold grid place-items-center">1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Open your Lovable dashboard</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tap the link below and sign in if needed. You'll see every project you've built.
                  </p>
                  <a
                    href="https://lovable.dev/projects"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Open lovable.dev/projects
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-gold-gradient text-primary-foreground text-xs font-bold grid place-items-center">2</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">For each project, click <span className="text-foreground">+ → GitHub → Connect project</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The plus button is in the bottom-left of the Lovable chat input. Authorize the Lovable GitHub app the first time — after that it's a one-tap action per project.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 h-6 w-6 rounded-full bg-gold-gradient text-primary-foreground text-xs font-bold grid place-items-center">3</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Come back here and tap <span className="text-foreground">"Import all my sites"</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ghConnected.connected
                      ? `You're connected as ${ghConnected.login}. Every Lovable project you linked to GitHub will appear in your Forge projects below.`
                      : "First time? Tap Import below, then Connect GitHub. After that the gold button (bottom-right) pulls in every linked repo."}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {!ghConnected.connected ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={connectGithub}
                        disabled={ghConnecting}
                        className="bg-gold-gradient text-primary-foreground hover:opacity-95 h-8"
                      >
                        {ghConnecting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Github className="h-3.5 w-3.5 mr-1.5" />}
                        {ghConnecting ? "Opening GitHub…" : "Connect GitHub"}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleMirrorAll}
                        disabled={mirroring}
                        className="bg-gold-gradient text-primary-foreground hover:opacity-95 h-8"
                      >
                        {mirroring ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5 mr-1.5" />}
                        {mirroring && mirrorStatus ? `Importing ${mirrorStatus.done}/${mirrorStatus.total}` : "Import all my sites"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            </ol>

            <p className="text-[11px] text-muted-foreground/80 mt-5">
              Tip: only the projects you link in Step 2 are visible to Forge. Repeat Step 2 for any project you want here.
            </p>
          </div>
        )}

        {ghConnected.connected && (
          <div className="mb-10">
            <div className="flex items-end justify-between mb-5 hairline-bottom-gold pb-4 gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/70 mb-1">
                  <Github className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                  GitHub · {ghConnected.login}
                </p>
                <h2 className="font-display text-3xl">Your repositories</h2>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={repoFilter}
                  onChange={(e) => setRepoFilter(e.target.value)}
                  placeholder="Filter…"
                  className="h-9 w-40 sm:w-56"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={loadRepos}
                  disabled={ghLoadingRepos}
                  className="hairline-gold"
                >
                  {ghLoadingRepos ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDisconnectGh}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Disconnect
                </Button>
              </div>
            </div>
            {ghLoadingRepos && ghRepos.length === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading your repositories…
              </div>
            ) : ghRepoError ? (
              <div className="rounded-xl hairline-gold bg-card/40 p-5 text-sm text-muted-foreground">{ghRepoError}</div>
            ) : ghRepos.length === 0 ? (
              <div className="rounded-xl hairline-gold bg-card/40 p-5 text-sm text-muted-foreground">No repositories found.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ghRepos
                  .filter((r) => !repoFilter.trim() || r.full_name.toLowerCase().includes(repoFilter.trim().toLowerCase()))
                  .slice(0, 60)
                  .map((r) => (
                    <div key={r.full_name} className="group rounded-2xl hairline-gold bg-card/70 backdrop-blur-sm p-4 hover:shadow-candlelight hover:border-primary/40 transition-all flex flex-col">
                      <div className="flex items-start gap-2 min-w-0">
                        <Github className="h-4 w-4 mt-1 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h3 className="font-medium truncate group-hover:text-gold transition-colors">{r.full_name}</h3>
                            {r.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1 min-h-[2rem]">
                            {r.description || "No description"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <a
                          href={`https://github.com/${r.full_name}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" /> View
                        </a>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => quickImportRepo(r.full_name, r.default_branch)}
                          disabled={!!importingRepo}
                          className="h-8 bg-gold-gradient text-primary-foreground hover:opacity-95"
                        >
                          {importingRepo === r.full_name ? (
                            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Importing…</>
                          ) : (
                            <><CloudDownload className="h-3.5 w-3.5 mr-1.5" /> Import</>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-end justify-between mb-8 hairline-bottom-gold pb-5">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-primary/70 mb-1">Atelier</p>
            <h2 className="font-display text-3xl">Your projects</h2>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="hairline-gold hover:bg-accent/30 hover:text-primary">
                <Plus className="h-4 w-4 mr-1.5" /> New
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">New project</DialogTitle>
              </DialogHeader>
              <form onSubmit={createProject} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Name</label>
                  <Input autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-app" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Description (optional)</label>
                  <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What are you building?" />
                </div>
                <DialogFooter>
                  <Button type="submit" className="bg-gold-gradient text-primary-foreground hover:opacity-95">Create</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl hairline-gold bg-card/40 p-14 text-center">
            <Hammer className="h-10 w-10 mx-auto text-primary mb-4" />
            <h3 className="font-display text-2xl">An empty forge</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
              Describe an idea above, or import a GitHub repo, and watch the first piece take shape.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <div key={p.id} className="group relative rounded-2xl hairline-gold bg-card/70 backdrop-blur-sm p-5 hover:shadow-candlelight hover:border-primary/40 transition-all">
                <Link to="/p/$projectId" params={{ projectId: p.id }} className="block">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-xl truncate group-hover:text-gold transition-colors">{p.name}</h3>
                    {p.published && p.slug && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium border border-primary/30">
                        <Globe className="h-2.5 w-2.5" /> Live
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5 min-h-[2.5rem]">{p.description || "No description"}</p>
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-3">
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
                      className="h-8 gap-1.5 px-2.5 text-xs hairline-gold"
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

      <Dialog open={ghOpen} onOpenChange={(o) => !ghImporting && setGhOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-4 w-4" /> Import from GitHub
            </DialogTitle>
          </DialogHeader>
          {!ghConnected.connected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your GitHub account to import private repositories, pick branches, and skip URL pasting.
              </p>
              <Button onClick={connectGithub} disabled={ghConnecting} className="w-full gap-2">
                {ghConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                {ghConnecting ? "Opening GitHub…" : "Connect GitHub"}
              </Button>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-wide"><span className="bg-background px-2 text-muted-foreground">or paste a public URL</span></div>
              </div>
              <form onSubmit={importFromGithub} className="space-y-3">
                <Input
                  value={ghUrl}
                  onChange={(e) => setGhUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  disabled={ghImporting}
                />
                {ghProgress && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {ghProgress}
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={ghImporting || !ghUrl.trim()}>
                    {ghImporting ? "Importing…" : "Import & open"}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          ) : (
            <form onSubmit={importFromGithub} className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Check className="h-3 w-3 text-primary" /> Connected as <span className="text-foreground font-medium">{ghConnected.login}</span>
                </span>
                <button type="button" onClick={handleDisconnectGh} className="text-muted-foreground hover:text-destructive">Disconnect</button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    Repository {ghRepos.length > 0 && <span className="text-muted-foreground/60">· {ghRepos.length} found</span>}
                  </label>
                  <button
                    type="button"
                    onClick={loadRepos}
                    disabled={ghLoadingRepos}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
                  >
                    {ghLoadingRepos ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
                  </button>
                </div>
                <Select value={ghSelectedRepo} onValueChange={(v) => { setGhSelectedRepo(v); setGhBranch(""); }} disabled={ghLoadingRepos || ghImporting}>
                  <SelectTrigger>
                    <SelectValue placeholder={ghLoadingRepos ? "Loading repos…" : "Pick a repository"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {ghRepos.length === 0 && !ghLoadingRepos && (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No repositories visible to this token.
                      </div>
                    )}
                    {ghRepos.map((r) => (
                      <SelectItem key={r.full_name} value={r.full_name}>
                        <span className="inline-flex items-center gap-1.5">
                          {r.private && <Lock className="h-3 w-3 text-muted-foreground" />}
                          {r.full_name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ghRepoError && (
                  <p className="text-[11px] text-destructive/90">{ghRepoError}</p>
                )}
                <Input
                  value={ghUrl}
                  onChange={(e) => setGhUrl(e.target.value)}
                  placeholder="Or paste https://github.com/owner/repo"
                  disabled={ghImporting}
                />
                <p className="text-[11px] text-muted-foreground">
                  Don't see a repo? Click Refresh, or paste a full <code className="px-1 rounded bg-muted/40">https://github.com/owner/repo</code> URL above.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Branch (optional)</label>
                  <Input value={ghBranch} onChange={(e) => setGhBranch(e.target.value)} placeholder="default" disabled={ghImporting} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Subfolder (optional)</label>
                  <Input value={ghSubpath} onChange={(e) => setGhSubpath(e.target.value)} placeholder="apps/web" disabled={ghImporting} />
                </div>
              </div>
              {ghProgress && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> {ghProgress}
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={ghImporting || (!ghSelectedRepo && !ghUrl.trim())}>
                  {ghImporting ? "Importing…" : "Import & open"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}