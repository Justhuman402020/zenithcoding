import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminBrain, saveCredential, updateCredential } from "@/lib/admin-brain.functions";
import { isScreenshotKey, MICROLINK_BASE_URL } from "@/lib/screenshot-key-policy";

type KeyRow = { id: string; label: string; base_url: string | null };

export function BrainScreenshotKeys() {
  const load = useServerFn(getAdminBrain);
  const save = useServerFn(saveCredential);
  const update = useServerFn(updateCredential);
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const data = await load({}); setRows(data.vault.filter(isScreenshotKey)); };
  useEffect(() => { void refresh().catch(() => toast.error("Could not load screenshot keys")); }, []);

  async function commit() {
    setBusy(true);
    try {
      if (editing) await update({ data: { id: editing, label, key } });
      else await save({ data: { label, key, kind: "url_key", baseUrl: MICROLINK_BASE_URL, notes: "Microlink screenshot capture key" } });
      setKey(""); setLabel(""); setEditing(null); setOpen(false);
      await refresh();
      toast.success("Screenshot key saved");
    } catch { toast.error("Could not save screenshot key. Please try again."); }
    finally { setBusy(false); }
  }

  return <section className="border-y border-border py-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl flex items-center gap-2"><Camera className="h-5 w-5 text-primary" /> Screenshot keys</h2>
      <Button size="sm" className="gap-1" onClick={() => { setEditing(null); setLabel(""); setKey(""); setOpen(true); }}><Plus className="h-4 w-4" /> Add Microlink key</Button>
    </div>
    <p className="text-sm text-muted-foreground">Microlink captures · OpenRouter reads · Cloudflare is not used for screenshots.</p>
    {open && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void commit(); }}>
      <Input aria-label="Screenshot key name" placeholder="Key name" value={label} onChange={e => setLabel(e.target.value)} required minLength={2} maxLength={80} />
      <Input aria-label="Microlink API key" type="password" autoComplete="new-password" placeholder="Microlink API key" value={key} onChange={e => setKey(e.target.value)} required minLength={4} />
      <div className="flex gap-2"><Button type="submit" disabled={busy || !label.trim() || key.trim().length < 4}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save screenshot key"}</Button><Button type="button" variant="ghost" onClick={() => { setOpen(false); setKey(""); }}>Cancel</Button></div>
    </form>}
    {!rows.length && <p className="text-sm text-muted-foreground">No saved screenshot keys. Microlink's limited free allowance is used until you add a key.</p>}
    <ol className="space-y-2">{rows.map((row, index) => <li key={row.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
      <span className="min-w-0 break-words">{index + 1}. {row.label}</span>
      <Button size="icon" variant="ghost" aria-label={`Replace ${row.label} screenshot key`} title="Replace key" onClick={() => { setEditing(row.id); setLabel(row.label); setKey(""); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
    </li>)}</ol>
  </section>;
}