import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listProjectSecrets,
  upsertProjectSecret,
  deleteProjectSecret,
} from "@/lib/project-secrets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, Trash2, Eye } from "lucide-react";

export function SecretsPanel({ projectId }: { projectId: string }) {
  const list = useServerFn(listProjectSecrets);
  const upsert = useServerFn(upsertProjectSecret);
  const del = useServerFn(deleteProjectSecret);
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [exposeToClient, setExposeToClient] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["project-secrets", projectId],
    queryFn: () => list({ data: { projectId } }),
  });
  const secrets = data?.secrets ?? [];

  function reset() {
    setKey(""); setValue(""); setDescription(""); setExposeToClient(false); setShowForm(false);
  }

  async function save() {
    if (!key.trim() || !value.trim()) return;
    setSaving(true);
    try {
      await upsert({
        data: {
          projectId,
          key: key.trim().toUpperCase(),
          value,
          expose_to_client: exposeToClient,
          description: description.trim() || undefined,
        },
      });
      toast.success("Secret saved");
      reset();
      qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, k: string) {
    if (!confirm(`Delete secret ${k}? This can't be undone.`)) return;
    try {
      await del({ data: { projectId, id } });
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="rounded-xl border p-5 space-y-4 bg-card/50">
      <div className="flex items-start gap-3">
        <KeyRound className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">Secrets & environment variables</h2>
          <p className="text-sm text-muted-foreground">
            Encrypted at rest. Injected into your app at runtime as <code className="text-xs">process.env.KEY</code>.
          </p>
        </div>
        {!showForm ? (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <div className="rounded-lg border bg-background/40 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="secret-key">Key</Label>
              <Input
                id="secret-key"
                placeholder="STRIPE_API_KEY"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                placeholder="sk_live_..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-desc">Description (optional)</Label>
            <Input
              id="secret-desc"
              placeholder="What this key is used for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="text-sm">
              <div className="font-medium">Expose to browser</div>
              <div className="text-xs text-muted-foreground">
                Only enable for publishable/public keys — never secret keys.
              </div>
            </div>
            <Switch checked={exposeToClient} onCheckedChange={setExposeToClient} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !key || !value}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Save secret
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : secrets.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground text-center py-4">No secrets yet.</p>
      ) : secrets.length > 0 ? (
        <div className="border rounded-md divide-y">
          {secrets.map((s) => (
            <div key={s.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-sm font-medium truncate">{s.key}</code>
                  {s.expose_to_client ? (
                    <Badge variant="secondary" className="text-[10px]"><Eye className="h-2.5 w-2.5 mr-1" />client</Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5">{s.masked}</div>
                {s.description ? <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div> : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(s.id, s.key)} title="Delete">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}