import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

type TraceRow = {
  id: string;
  trace_id: string;
  seq: number;
  phase: string;
  status: string;
  message: string | null;
  detail: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: string;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "error") return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === "warn") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
}

export function TracePanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("chat_traces")
      .select("id,trace_id,seq,phase,status,message,detail,duration_ms,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(300);
    setRows((data ?? []) as TraceRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runs = new Map<string, TraceRow[]>();
  for (const row of rows) {
    const list = runs.get(row.trace_id) ?? [];
    list.push(row);
    runs.set(row.trace_id, list);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Build traces</h2>
          <p className="text-xs text-muted-foreground">
            Every AI edit, step by step — model choice, each file read and write, and where it failed.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {!loading && runs.size === 0 && (
        <p className="text-xs text-muted-foreground">No builds traced yet. Send a chat message in the editor.</p>
      )}

      <div className="space-y-2">
        {[...runs.entries()].map(([traceId, events]) => {
          const ordered = [...events].sort((a, b) => a.seq - b.seq);
          const failed = ordered.some((event) => event.status === "error");
          const writes = ordered.filter((event) => event.phase === "tool.write_file" && event.status === "ok").length;
          const expanded = open === traceId;
          return (
            <div key={traceId} className="rounded-lg border border-border/70">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : traceId)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <StatusIcon status={failed ? "error" : "ok"} />
                <span className="flex-1 truncate text-xs">
                  {new Date(ordered[0].created_at).toLocaleString()} · {ordered.length} steps · {writes} file
                  {writes === 1 ? "" : "s"} saved
                </span>
                <code className="hidden text-[10px] text-muted-foreground sm:inline">{traceId.slice(0, 8)}</code>
              </button>
              {expanded && (
                <ul className="space-y-1 border-t border-border/70 px-3 py-2">
                  {ordered.map((event) => (
                    <li key={event.id} className="flex items-start gap-2 text-[11px]">
                      <StatusIcon status={event.status} />
                      <span className="font-mono">{event.phase}</span>
                      {event.duration_ms != null && (
                        <span className="text-muted-foreground">{event.duration_ms}ms</span>
                      )}
                      <span className="flex-1 break-all text-muted-foreground">
                        {event.message ?? (event.detail && Object.keys(event.detail).length > 0
                          ? JSON.stringify(event.detail)
                          : "")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
