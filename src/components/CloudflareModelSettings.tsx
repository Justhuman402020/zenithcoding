import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getEditorModelControls, refreshEditorModelControls, savePoolModelSettings } from "@/lib/model-controls.functions";

export function CloudflareModelSettings() {
  const load = useServerFn(getEditorModelControls);
  const refresh = useServerFn(refreshEditorModelControls);
  const save = useServerFn(savePoolModelSettings);
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load({}).then(setData); }, [load]);
  const models = useMemo(() => [...new Map((data?.coding ?? []).map((item) => [item.model, item])).values()], [data]);
  async function select(model: string) { setBusy(true); try { await save({ data: { codingModel: model } }); setData((cur) => cur ? { ...cur, settings: { ...cur.settings, coding_model: model } } : cur); toast.success("Cloudflare model changed across all keys"); } finally { setBusy(false); } }
  async function reload() { setBusy(true); try { setData(await refresh({})); toast.success("Only working free-tier models are shown"); } catch (e) { toast.error(e instanceof Error ? e.message : "Refresh failed"); } finally { setBusy(false); } }
  return <section className="rounded-xl border p-4 space-y-3">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Cloudflare model across all keys</h2><p className="text-xs text-muted-foreground">Working free-tier Qwen and GLM-4 models only. Bad or inaccessible models are removed on refresh.</p></div><Button size="icon" variant="outline" onClick={reload} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button></div>
    <div className="grid gap-2 sm:grid-cols-2">{models.map((item) => <Button key={item.model} type="button" variant={data?.settings.coding_model === item.model ? "default" : "outline"} className="h-auto justify-start py-2 text-left" disabled={busy} onClick={() => select(item.model)}><span className="truncate"><span className="block text-sm">{item.label}</span><span className="block text-[11px] opacity-70 truncate">{item.model}</span></span></Button>)}</div>
    {!busy && models.length === 0 ? <p className="text-xs text-muted-foreground">Add or refresh a Cloudflare Workers AI key to detect models.</p> : null}
  </section>;
}
