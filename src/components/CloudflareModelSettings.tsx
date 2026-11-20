import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncCloudflareMetaLicense } from "@/lib/admin-models.functions";
import { getEditorModelControls, refreshEditorModelControls, savePoolModelSettings } from "@/lib/model-controls.functions";

export function CloudflareModelSettings() {
  const load = useServerFn(getEditorModelControls);
  const refresh = useServerFn(refreshEditorModelControls);
  const save = useServerFn(savePoolModelSettings);
  const syncLicense = useServerFn(syncCloudflareMetaLicense);
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load({}).then(setData); }, [load]);
  const models = useMemo(() => [...new Map((data?.coding ?? []).map((item) => [item.model, item])).values()], [data]);
  async function select(model: string) { setBusy(true); try { await save({ data: { codingModel: model } }); setData((cur) => cur ? { ...cur, settings: { ...cur.settings, coding_model: model } } : cur); toast.success("Cloudflare model changed across all keys"); } finally { setBusy(false); } }
  async function reload() { setBusy(true); try { setData(await refresh({})); toast.success("Only working free-tier models are shown"); } catch (e) { toast.error(e instanceof Error ? e.message : "Refresh failed"); } finally { setBusy(false); } }
  const [failures, setFailures] = useState<{ label: string; error: string }[]>([]);
  async function agreeAll() { setBusy(true); try { const r = await syncLicense({}); setFailures(r.failures); if (r.failures.length) toast.warning(`License accepted on ${r.agreed} of ${r.total} keys — ${r.failures.length} failed (see list)`); else toast.success(`Llama 3.2 Vision license accepted on ${r.agreed} of ${r.total} keys`); setData(await refresh({})); } catch (e) { toast.error(e instanceof Error ? e.message : "License sync failed"); } finally { setBusy(false); } }
  return <section className="rounded-xl border p-4 space-y-3">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Cloudflare model across all keys</h2><p className="text-xs text-muted-foreground">Working free-tier Qwen, GLM-4 and vision models. Bad or inaccessible models are removed on refresh.</p></div><Button size="icon" variant="outline" onClick={reload} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button></div>
    <div className="grid gap-2 sm:grid-cols-2">{models.map((item) => <Button key={item.model} type="button" variant={data?.settings.coding_model === item.model ? "default" : "outline"} className="h-auto justify-start py-2 text-left" disabled={busy} onClick={() => select(item.model)}><span className="truncate"><span className="flex items-center gap-1.5 text-sm">{item.label}{item.vision ? <span className="rounded border px-1 text-[10px] uppercase opacity-80">vision</span> : null}</span><span className="block text-[11px] opacity-70 truncate">{item.model}</span></span></Button>)}</div>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={agreeAll}>Accept Llama 3.2 Vision license on all keys</Button>
    {failures.length ? <ul className="space-y-1 rounded-lg border border-destructive/40 p-2 text-xs">{failures.map((f) => <li key={f.label}><span className="font-medium text-destructive">{f.label}:</span> <span className="text-muted-foreground break-all">{f.error}</span></li>)}</ul> : null}
    {!busy && models.length === 0 ? <p className="text-xs text-muted-foreground">Add or refresh a Cloudflare Workers AI key to detect models.</p> : null}
  </section>;
}
