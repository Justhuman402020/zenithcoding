import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2, Code2, LogOut } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Project = { id: string; name: string; description: string | null; updated_at: string };

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

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,updated_at")
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

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its files?")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setProjects((p) => p.filter((x) => x.id !== id));
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Forge</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Projects</h2>
            <p className="text-sm text-muted-foreground mt-1">Spin up an AI-built coding project.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button style={{ background: "var(--gradient-primary)" }} className="text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" /> New project
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
                  <h3 className="font-medium truncate">{p.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-[2.5rem]">{p.description || "No description"}</p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Edited {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                  </p>
                </Link>
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