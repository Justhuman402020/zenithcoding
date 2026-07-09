import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  listAllUsers,
  listUserProjects,
  deleteUserAsAdmin,
  getMyRole,
} from "@/lib/admin-users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck, Users, Trash2, ExternalLink, FolderKanban, Search, Loader2, ArrowLeft, Lock,
} from "lucide-react";
import { ForgeMark } from "@/components/ForgeMark";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Forge — Admin users" }] }),
  component: AdminUsersPage,
});

type Row = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  project_count: number;
  is_admin: boolean;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  published: boolean;
  slug: string | null;
  lovable_project_id: string | null;
};

function AdminUsersPage() {
  const navigate = useNavigate();
  const fetchRole = useServerFn(getMyRole);
  const fetchUsers = useServerFn(listAllUsers);
  const fetchProjects = useServerFn(listUserProjects);
  const doDelete = useServerFn(deleteUserAsAdmin);

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [openUser, setOpenUser] = useState<Row | null>(null);
  const [userProjects, setUserProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchRole({})
      .then(({ isAdmin }) => {
        setIsAdmin(isAdmin);
        if (isAdmin) load();
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setChecking(false));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { users } = await fetchUsers({});
      setRows(users);
    } catch (e: any) {
      toast.error(e?.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  }

  async function openProjects(user: Row) {
    setOpenUser(user);
    setUserProjects([]);
    setLoadingProjects(true);
    try {
      const { projects } = await fetchProjects({ data: { userId: user.id } });
      setUserProjects(projects);
    } catch (e: any) {
      toast.error(e?.message || "Could not load projects");
    } finally {
      setLoadingProjects(false);
    }
  }

  async function removeUser(user: Row) {
    if (!confirm(`Delete ${user.email ?? user.id}? This removes all their projects and files.`)) return;
    setDeleting(user.id);
    try {
      await doDelete({ data: { userId: user.id } });
      toast.success("User removed");
      setRows((prev) => prev.filter((r) => r.id !== user.id));
      if (openUser?.id === user.id) setOpenUser(null);
    } catch (e: any) {
      toast.error(e?.message || "Could not delete");
    } finally {
      setDeleting(null);
    }
  }

  if (checking) {
    return (
      <div className="min-h-[100dvh] grid place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-4">
        <div className="max-w-md w-full rounded-2xl hairline-gold bg-card/70 p-6 text-center space-y-3">
          <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
          <h1 className="font-display text-xl">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            Your account isn't an admin. This page is restricted to designated admin accounts.
          </p>
          <Button onClick={() => navigate({ to: "/" })} className="bg-gold-gradient text-primary-foreground">
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const filtered = rows.filter((r) =>
    !query.trim() ? true : (r.email ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <ForgeMark className="h-7 w-7" glow />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg">Admin · Users</h1>
              <span className="inline-flex items-center gap-1 text-[11px] rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 px-2 py-0.5">
                <ShieldCheck className="h-3 w-3" /> admin
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Manage every account on Forge.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/" })} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email…"
              className="pl-9"
            />
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-4 w-4" /> {rows.length} user{rows.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="rounded-xl hairline-gold overflow-hidden bg-card/60">
          {loading ? (
            <div className="p-8 grid place-items-center text-muted-foreground text-sm">
              <Loader2 className="h-5 w-5 animate-spin mb-2" /> Loading users…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No users match.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{u.email ?? "(no email)"}</span>
                      {u.is_admin && (
                        <span className="inline-flex items-center gap-1 text-[10px] rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5">
                          <ShieldCheck className="h-3 w-3" /> admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{u.project_count} project{u.project_count === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>joined {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}</span>
                      {u.last_sign_in_at && (
                        <>
                          <span>·</span>
                          <span>seen {formatDistanceToNow(new Date(u.last_sign_in_at), { addSuffix: true })}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openProjects(u)} className="gap-1.5">
                    <FolderKanban className="h-4 w-4" /> Projects
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleting === u.id || u.is_admin}
                    onClick={() => removeUser(u)}
                    title={u.is_admin ? "Cannot delete another admin from this UI" : "Delete user"}
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    {deleting === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {openUser && (
          <div className="rounded-xl hairline-gold bg-card/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-primary" />
              <h2 className="font-medium">Projects by {openUser.email ?? openUser.id}</h2>
              <Button variant="ghost" size="sm" onClick={() => setOpenUser(null)} className="ml-auto">
                Close
              </Button>
            </div>
            {loadingProjects ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
              </div>
            ) : userProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No projects.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {userProjects.map((p) => (
                  <li key={p.id} className="py-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.description || "—"} · updated {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                        {p.lovable_project_id ? " · imported from Lovable" : ""}
                      </div>
                    </div>
                    {p.published && p.slug && (
                      <a
                        href={`/s/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> live
                      </a>
                    )}
                    <Link
                      to="/p/$projectId"
                      params={{ projectId: p.id }}
                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      open <ExternalLink className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
