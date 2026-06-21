import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Clock, History, Loader2, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Snapshot = {
  id: string;
  label: string;
  created_at: string;
  files: Array<{ path: string; content: string }>;
};

export function HistoryPanel({
  projectId,
  onRestored,
}: {
  projectId: string;
  onRestored: () => void;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("project_snapshots")
      .select("id,label,created_at,files")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40);
    setSnaps((data ?? []) as Snapshot[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Poll on focus so new auto-snapshots show up after AI turns
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId]);

  async function restore(snap: Snapshot) {
    if (!confirm(`Restore "${snap.label}" from ${formatDistanceToNow(new Date(snap.created_at), { addSuffix: true })}? Your current files will be replaced.`)) return;
    setRestoringId(snap.id);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new Error("Please sign in again");

      const { error: delErr } = await supabase.from("files").delete().eq("project_id", projectId);
      if (delErr) throw delErr;
      if (snap.files.length > 0) {
        const rows = snap.files.map((f) => ({
          project_id: projectId,
          user_id: userRes.user!.id,
          path: f.path,
          content: f.content,
        }));
        const { error: insErr } = await supabase.from("files").insert(rows);
        if (insErr) throw insErr;
      }
      toast.success(`Restored "${snap.label}"`);
      onRestored();
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not restore");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-3 hairline-bottom-gold flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="font-display text-lg">Version history</h3>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {snaps.length} {snaps.length === 1 ? "snapshot" : "snapshots"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading…
          </div>
        ) : snaps.length === 0 ? (
          <div className="p-6 text-center">
            <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No snapshots yet. Forge saves one automatically before each AI build, so you can roll back any time.
            </p>
          </div>
        ) : (
          <ol className="relative">
            {snaps.map((s, i) => (
              <li key={s.id} className="relative px-4 py-3 hairline-bottom-gold last:border-b-0">
                <div className="absolute left-0 top-0 bottom-0 w-px bg-border/60" />
                <div className="absolute left-[-3px] top-5 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(240,215,140,0.6)]" />
                <div className="flex items-start gap-3 pl-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.label === "auto" ? `Build · ${i === 0 ? "Latest" : `#${snaps.length - i}`}` : s.label}
                    </p>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/80 mt-0.5">
                      {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })} ·{" "}
                      {s.files.length} {s.files.length === 1 ? "file" : "files"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 hairline-gold hover:text-primary"
                    disabled={restoringId === s.id}
                    onClick={() => restore(s)}
                  >
                    {restoringId === s.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Restore
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}