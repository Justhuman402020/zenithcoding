import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Plus, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveCredential, updateCredential } from "@/lib/admin-brain.functions";
import { listScreenshotKeys, setActiveScreenshotKey } from "@/lib/screenshot-keys.functions";
import { SCREENSHOTONE_BASE_URL } from "@/lib/screenshot-key-policy";

type KeyRow = Awaited<ReturnType<typeof listScreenshotKeys>>["keys"][number];

export function BrainScreenshotKeys() {
  const load = useServerFn(listScreenshotKeys);
  const save = useServerFn(saveCredential);
  const update = useServerFn(updateCredential);
  const activate = useServerFn(setActiveScreenshotKey);
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setLoading(true); try { setRows((await load({})).keys); } finally { setLoading(false); } };
  useEffect(() => { void refresh().catch(() => toast.error("Could not load screenshot keys")); }, []);

  async function commit() {
    setBusy(true);
    try {
      if (editing) await update({ data: { id: editing, label, key } });
      else await save({ data: { label, key, kind: "url_key", baseUrl: SCREENSHOTONE_BASE_URL, notes: "ScreenshotOne screenshot capture key" } });
      setKey(""); setLabel(""); setEditing(null); setOpen(false);
      await refresh();
      toast.success("Screenshot key saved");
    } catch { toast.error("Could not save screenshot key. Please try again."); }
    finally { setBusy(false); }
  }

  async function toggle(row: KeyRow, on: boolean) {
    setRows(rs => rs.map(r => ({ ...r, active: on ? r.id === row.id : false })));
    try { await activate({ data: { id: on ? row.id : null } }); toast.success(on ? `${row.label} is now used for screenshots` : "Screenshots turned off"); }
    catch { toast.error("Could not change the key"); await refresh(); }
  }

  return <section className="border-y border-border py-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl flex items-center gap-2"><Camera className="h-5 w-5 text-primary" /> Screenshot keys</h2>
      <div className="flex gap-2">
        <Button size="icon" variant="ghost" aria-label="Refresh remaining screenshots" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        <Button size="sm" className="gap-1" onClick={() => { setEditing(null); setLabel(""); setKey(""); setOpen(true); }}><Plus className="h-4 w-4" /> Add ScreenshotOne key</Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">ScreenshotOne takes the pictures · OpenRouter reads them. Your agent uses only the key you turn on.</p>
    {open && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void commit(); }}>
      <Input aria-label="Screenshot key name" placeholder="Key name" value={label} onChange={e => setLabel(e.target.value)} required minLength={2} maxLength={80} />
      <Input aria-label="ScreenshotOne access key" type="password" autoComplete="new-password" placeholder="ScreenshotOne access key" value={key} onChange={e => setKey(e.target.value)} required minLength={4} />
      <div className="flex gap-2"><Button type="submit" disabled={busy || !label.trim() || key.trim().length < 4}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save screenshot key"}</Button><Button type="button" variant="ghost" onClick={() => { setOpen(false); setKey(""); }}>Cancel</Button></div>
    </form>}
    {!loading && !rows.length && <p className="text-sm text-muted-foreground">No ScreenshotOne keys yet. Add one, then turn it on.</p>}
    {!loading && rows.length > 0 && !rows.some(r => r.active) && <p className="text-sm text-destructive">No key is on — your agent can't take screenshots until you turn one on.</p>}
    <ol className="space-y-2">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
      <div className="min-w-0">
        <p className="break-words font-medium">{row.label}</p>
        <p className="text-xs text-muted-foreground">{row.usage ? `${row.usage.available} of ${row.usage.total} screenshots left` : row.problem ?? "Checking…"}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Switch aria-label={`Use ${row.label} for screenshots`} checked={row.active} onCheckedChange={on => void toggle(row, on)} />
        <Button size="icon" variant="ghost" aria-label={`Replace ${row.label} screenshot key`} title="Replace key" onClick={() => { setEditing(row.id); setLabel(row.label); setKey(""); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
      </div>
    </li>)}</ol>
  </section>;
}
