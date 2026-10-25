import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceAI, saveWorkspaceAI, testBuildRouterKey, activateBuildRouterKey, getBuildRouterModels } from "@/lib/workspace.functions";
import { Input } from "./ui/input";
import { getModelBoard } from "@/lib/admin-models.functions";
import { Button } from "./ui/button";
import { toast } from "sonner";
export function BuildEngineSettings({ rows, providers }: { rows: Awaited<ReturnType<typeof getModelBoard>>["rows"]; providers: Awaited<ReturnType<typeof getModelBoard>>["providers"] }) {
  const load = useServerFn(getWorkspaceAI);
  const save = useServerFn(saveWorkspaceAI);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getWorkspaceAI>> | null>(null);
  const [busy, setBusy] = useState(false);
  const testKey = useServerFn(testBuildRouterKey);
  const activateKey = useServerFn(activateBuildRouterKey);
  const loadModels = useServerFn(getBuildRouterModels);
  const [pasted, setPasted] = useState("");
  const [tested, setTested] = useState<string | null>(null);
  const [router, setRouter] = useState<Awaited<ReturnType<typeof getBuildRouterModels>> | null>(null);
  useEffect(() => { void load().then(setSettings); void loadModels().then(setRouter).catch(() => {}); }, [load, loadModels]);
  // Provider identity comes from its verified registry, not its editable label.
  const routerIds = providers.filter((p) => p.provider === "openrouter" || p.provider.startsWith("custom-openrouter") || p.providerLabel.toLowerCase().includes("openrouter")).map((p) => p.provider);
  void routerIds; void rows;
  // Build models come only from the key pasted here, not Admin's OpenRouter providers.
  const options = (router?.models ?? []).map((m) => ({ provider: router!.provider, model: m.id, label: m.label, providerLabel: "Build key", vision: m.vision }));
  if (!settings) return null;
  function pick(value: string) { const [provider, ...model] = value.split("|"); return provider && model.length ? { provider, model: model.join("|") } : null; }
  return <section className="space-y-4 border-y py-5"><h2 className="font-semibold">Build engine</h2>
    <div className="flex gap-2">{(["openrouter", "cloudflare"] as const).map((engine) => <Button key={engine} variant={settings.engine === engine ? "default" : "outline"} onClick={() => setSettings({ ...settings, engine })}>{engine === "openrouter" ? "OpenRouter" : "Cloudflare pool"}</Button>)}</div>
    <div className="space-y-2"><span className="text-sm">OpenRouter build key {router?.active ? <b className="text-primary">· active ({router.models.length} models)</b> : "· not active"}</span>
      <div className="flex flex-wrap gap-2"><Input type="password" autoComplete="off" placeholder="sk-or-v1-..." value={pasted} onChange={(e) => { setPasted(e.target.value); setTested(null); }} className="max-w-sm" />
        <Button variant="outline" disabled={busy || pasted.length < 10} onClick={async () => { setBusy(true); try { const r = await testKey({ data: { apiKey: pasted } }); setTested(r.ok ? pasted : null); r.ok ? toast.success(`Key works · ${r.count} models`) : toast.error(r.error ?? "Key failed"); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>Test</Button>
        <Button disabled={busy || tested !== pasted || !pasted} onClick={async () => { setBusy(true); try { await activateKey({ data: { apiKey: pasted } }); setPasted(""); setTested(null); setRouter(await loadModels()); toast.success("Key activated — pick models below"); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>Activate</Button></div>
      {router?.error && <p className="text-xs text-destructive">{router.error}</p>}</div>
    <div className="grid gap-3 sm:grid-cols-2">{(["text", "image"] as const).map((kind) => <label key={kind} className="text-sm space-y-1"><span>{kind === "text" ? "Text model · Nemotron Lightning" : "Image model · Nemotron VL"}</span><select aria-label={`${kind} build model`} className="w-full border rounded-md bg-background p-2 text-xs" value={settings[kind] ? `${settings[kind]?.provider}|${settings[kind]?.model}` : ""} onChange={(e) => setSettings({ ...settings, [kind]: pick(e.target.value) })}><option value="">Select manually</option>{options.filter((r) => kind === "text" || r.vision).map((r) => <option key={`${r.provider}|${r.model}`} value={`${r.provider}|${r.model}`}>{r.label} · {r.providerLabel}</option>)}</select></label>)}</div>
    <label className="flex flex-wrap items-center gap-3 text-sm">Chat helper<select aria-label="Chat engine" className="border rounded-md bg-background p-2" value={settings.chatEngine} onChange={(e) => setSettings({ ...settings, chatEngine: e.target.value })}><option value="openrouter">OpenRouter</option><option value="ollama">Previous Ollama setup</option></select></label>
    <Button disabled={busy} onClick={async () => { setBusy(true); try { await save({ data: { ...settings, chatEngine: settings.chatEngine as "openrouter" | "ollama" } }); toast.success("Saved for new builds"); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>Save</Button>
    <p className="text-xs text-muted-foreground">Planning: Cloudflare only. Running builds keep their starting engine.</p>
  </section>;
}