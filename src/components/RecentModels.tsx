import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { listRecentModelCalls } from "@/lib/workspace.functions";
import { SECTION_LABELS, formatMs, type CallSection } from "@/lib/model-calls";
import { ProviderIcon, providerName } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";

type Row = Awaited<ReturnType<typeof listRecentModelCalls>>["rows"][number];
const FILTERS: Array<"all" | CallSection> = ["all", "plan", "build", "image_build", "chat", "assistant", "skill"];

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function RecentModels() {
  const load = useServerFn(listRecentModelCalls);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { setErr(null); load({ data: { section: filter } }).then((r) => setRows(r.rows)).catch((e) => setErr(e?.message ?? "Could not load")); };
  useEffect(() => { setRows(null); refresh(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const m = new Map<string, { provider: string; base: string | null; model: string; last: string; times: number[] }>();
    for (const r of rows ?? []) {
      const k = `${r.provider}|${r.model}`;
      const e = m.get(k) ?? { provider: r.provider, base: r.base_url, model: r.model, last: r.created_at, times: [] };
      if (r.status === "ok" && r.total_ms != null) e.times.push(r.total_ms);
      m.set(k, e);
    }
    return [...m.values()].slice(0, 6);
  }, [rows]);

  return (
    <section className="rounded-xl border border-border bg-card/60 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Recent models</h2>
          <p className="text-xs text-muted-foreground">Which models replied lately and how long they took. Last 30 days.</p>
        </div>
        <Button size="icon" variant="ghost" onClick={refresh} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {f === "all" ? "All" : SECTION_LABELS[f]}
          </button>
        ))}
      </div>
      {summary.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.map((s) => (
            <div key={`${s.provider}|${s.model}`} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <ProviderIcon provider={s.provider} baseUrl={s.base} className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium">{s.model}</div>
                <div className="text-muted-foreground">Last {ago(s.last)} · avg {s.times.length ? formatMs(Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length)) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!rows && !err && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
      {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No replies recorded yet. They'll show up here after your next chat, plan or build.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 rounded-md bg-muted/60 p-1.5 text-primary" title={providerName(r.provider, r.base_url)}>
                <ProviderIcon provider={r.provider} baseUrl={r.base_url} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{r.model}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">{SECTION_LABELS[r.section as CallSection] ?? r.section}</span>
                  {r.key_index != null && <span className="text-[10px] text-muted-foreground">key #{r.key_index}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {providerName(r.provider, r.base_url)} · {ago(r.created_at)} · first reply {formatMs(r.first_token_ms)} · total {formatMs(r.total_ms)}
                </div>
                {r.status !== "ok" && <div className="text-xs text-destructive">Failed{r.error_short ? `: ${r.error_short}` : ""}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
