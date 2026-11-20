import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, Loader2, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getAdminBrain, revealCredential, updateCredential } from "@/lib/admin-brain.functions";

type Vault = { id: string; label: string; kind: string; base_url: string | null; account_id: string | null; notes: string | null };

/** Every key saved in the Brain vault, with note, reveal, copy and edit. */
export function VaultKeyList() {
  const load = useServerFn(getAdminBrain);
  const [vault, setVault] = useState<Vault[] | null>(null);
  const refresh = () => load({}).then((r) => setVault(r.vault)).catch(() => setVault([]));
  useEffect(() => { void refresh(); }, []);

  if (!vault) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!vault.length) return <p className="text-sm text-muted-foreground">No keys in the Brain vault yet.</p>;
  return <div className="grid gap-3">{vault.map((v) => <VaultRow key={v.id} v={v} onChanged={refresh} />)}</div>;
}

function VaultRow({ v, onChanged }: { v: Vault; onChanged: () => void }) {
  const reveal = useServerFn(revealCredential);
  const update = useServerFn(updateCredential);
  const [value, setValue] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ label: v.label, key: "", baseUrl: v.base_url ?? "", accountId: v.account_id ?? "" });
  const [note, setNote] = useState(v.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function getValue() {
    if (value !== null) return value;
    const r = await reveal({ data: { id: v.id } });
    setValue(r.key);
    return r.key;
  }

  async function toggleShow() {
    try { if (!shown) await getValue(); setShown(!shown); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not reveal"); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(await getValue());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("Could not copy"); }
  }

  async function save(patch: Parameters<typeof update>[0]["data"]) {
    setBusy(true);
    try {
      await update({ data: patch });
      toast.success("Saved");
      if (patch.key) setValue(patch.key);
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{v.label}</div>
          {v.base_url ? <div className="text-xs text-muted-foreground truncate">{v.base_url}</div> : null}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label={shown ? "Hide key" : "Show key"} onClick={toggleShow}>{shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          <Button size="icon" variant="ghost" aria-label="Copy key" onClick={copy}>{copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}</Button>
          <Button size="icon" variant="ghost" aria-label="Edit key" onClick={() => setEditing((x) => !x)}>{editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}</Button>
        </div>
      </div>
      <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs break-all">{shown && value !== null ? value : "••••••••••••••••"}</div>
      {editing ? (
        <div className="space-y-2">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Name" />
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="Base URL (optional)" />
          <Input value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} placeholder="ID (optional)" />
          <Input type="password" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="New key (leave empty to keep)" />
          <Button size="sm" disabled={busy} onClick={() => save({ id: v.id, label: form.label, baseUrl: form.baseUrl, accountId: form.accountId, key: form.key || undefined })} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
          </Button>
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the agent — what this key is for, when to use it" className="text-sm" />
        <Button size="icon" variant="outline" aria-label="Save note" disabled={busy || note === (v.notes ?? "")} onClick={() => save({ id: v.id, notes: note })}>
          <Save className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
