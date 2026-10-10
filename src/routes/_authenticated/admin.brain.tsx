import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Brain, KeyRound, Loader2, Plus, ScanSearch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrainNotesEditor } from "@/components/BrainNotesEditor";
import { deleteCredential, getAdminBrain, saveAdminBrain, saveCredential, scanCredentialModels } from "@/lib/admin-brain.functions";

export const Route = createFileRoute("/_authenticated/admin/brain")({
  head: () => ({
    meta: [
      { title: "Code Haven — Admin Brain" },
      { name: "description", content: "Global agent rules and the credential vault for Code Haven." },
      { property: "og:title", content: "Code Haven Admin Brain" },
      { property: "og:description", content: "Global agent rules and the credential vault for Code Haven." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminBrainPage,
});

const DEFAULT_RULES = `- Act autonomously like Lovable: finish the whole task without asking for permission.
- Use every available tool (files, web search, images, execute_sql, attach_credential).
- If a database table is missing, create it with execute_sql (CREATE TABLE IF NOT EXISTS + RLS + policies).
- Use saved vault keys via attach_credential instead of asking the user again.`;

type Kind = "key" | "key_id" | "url_key";
type Vault = { id: string; label: string; kind: string; base_url: string | null; account_id: string | null; notes: string | null };

function AdminBrainPage() {
  const navigate = useNavigate();
  const load = useServerFn(getAdminBrain);
  const save = useServerFn(saveAdminBrain);
  const addCred = useServerFn(saveCredential);
  const delCred = useServerFn(deleteCredential);
  const scan = useServerFn(scanCredentialModels);

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState("");
  const [vault, setVault] = useState<Vault[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: "", kind: "key" as Kind, key: "", baseUrl: "", accountId: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<Record<string, { count: number; models: string[]; error: string | null }>>({});

  const refresh = () =>
    load({})
      .then((r) => {
        setRules(r.content || DEFAULT_RULES);
        setVault(r.vault);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Admin only"))
      .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
  }, []);

  const doScan = async (id: string, importProvider = false) => {
    setBusy(id);
    try {
      const r = await scan({ data: { id, importProvider } });
      setScanResult((s) => ({ ...s, [id]: { count: r.modelCount, models: r.models, error: r.error } }));
      if (r.imported) toast.success(`Imported — ${r.modelCount} models now available to the agent`);
      else if (r.ok) toast.success(`Key works — ${r.modelCount} models found`);
      else toast.error(r.error ?? "Key did not work");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="min-h-[100dvh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin" })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Admin
        </Button>

        <section className="rounded-2xl border border-border bg-card/70 p-5 space-y-3">
          <h1 className="font-display text-xl flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Global agent rules</h1>
          <p className="text-sm text-muted-foreground">These rules are added to every agent run, in every project.</p>
          <Textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={10} className="font-mono text-sm" />
          <Button
            disabled={busy === "rules"}
            onClick={async () => {
              setBusy("rules");
              try {
                await save({ data: { content: rules } });
                toast.success("Rules saved");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Save failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Save rules
          </Button>
        </section>

        <BrainNotesEditor />

        <section className="rounded-2xl border border-border bg-card/70 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Credential vault</h2>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)} className="gap-1"><Plus className="h-4 w-4" /> Add any API key</Button>
          </div>
          <p className="text-sm text-muted-foreground">Keys are stored locked. The agent can copy them into a project but never sees the values.</p>

          {showAdd ? (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap gap-2">
                {([["key", "Key only"], ["key_id", "Key + ID"], ["url_key", "URL + Key"]] as const).map(([k, l]) => (
                  <Button key={k} size="sm" variant={form.kind === k ? "default" : "outline"} onClick={() => setForm({ ...form, kind: k })}>{l}</Button>
                ))}
              </div>
              <Input placeholder="Name (e.g. Google AI Studio, Groq, My Supabase)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              {form.kind === "url_key" ? <Input placeholder="Base URL (e.g. https://xyz.supabase.co or https://api.example.com/v1)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /> : null}
              {form.kind === "key_id" ? <Input placeholder="ID (e.g. Cloudflare Account ID)" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} /> : null}
              <Input type="password" placeholder="API key / token" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
              <Button
                disabled={busy === "add"}
                onClick={async () => {
                  setBusy("add");
                  try {
                    await addCred({ data: { label: form.label, kind: form.kind, key: form.key, baseUrl: form.baseUrl || undefined, accountId: form.accountId || undefined } });
                    toast.success("Saved to vault");
                    setForm({ label: "", kind: "key", key: "", baseUrl: "", accountId: "" });
                    setShowAdd(false);
                    await refresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Save key
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            {vault.length === 0 ? <p className="text-sm text-muted-foreground">No keys saved yet.</p> : null}
            {vault.map((v) => {
              const res = scanResult[v.id];
              return (
                <div key={v.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{v.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {v.kind === "key" ? "Key only" : v.kind === "key_id" ? "Key + ID" : "URL + Key"}{v.base_url ? ` · ${v.base_url}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" disabled={busy === v.id} onClick={() => void doScan(v.id)} className="gap-1">
                        {busy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} Test & Scan Models
                      </Button>
                      <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete" onClick={async () => { await delCred({ data: { id: v.id } }); await refresh(); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {res ? (
                    res.error && !res.count ? (
                      <p className="text-xs text-destructive">{res.error}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{res.count} models available: {res.models.slice(0, 8).join(", ")}{res.count > 8 ? "…" : ""}</p>
                        <Button size="sm" disabled={busy === v.id} onClick={() => void doScan(v.id, true)}>Import & enable these models</Button>
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
