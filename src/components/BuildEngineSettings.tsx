import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceAI, saveWorkspaceAI } from "@/lib/workspace.functions";
import { getModelBoard } from "@/lib/admin-models.functions";
import { Button } from "./ui/button";
import { toast } from "sonner";
export function BuildEngineSettings({ rows, providers }: { rows: Awaited<ReturnType<typeof getModelBoard>>["rows"]; providers: Awaited<ReturnType<typeof getModelBoard>>["providers"] }) {
  const load = useServerFn(getWorkspaceAI);
  const save = useServerFn(saveWorkspaceAI);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getWorkspaceAI>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load().then(setSettings); }, [load]);
  // Provider identity comes from its verified registry, not its editable label.
  const routerIds = providers.filter((p) => p.provider === "openrouter" || p.provider.startsWith("custom-openrouter")).map((p) => p.provider);
  const options = rows.filter((r) => routerIds.includes(r.provider) && r.keyConfigured);
  if (!settings) return null;
  function pick(value: string) { const [provider, ...model] = value.split("|"); return provider && model.length ? { provider, model: model.join("|") } : null; }
  return <section className="space-y-4 border-y py-5"><h2 className="font-semibold">Build engine</h2>
    <div className="flex gap-2">{(["openrouter", "cloudflare"] as const).map((engine) => <Button key={engine} variant={settings.engine === engine ? "default" : "outline"} onClick={() => setSettings({ ...settings, engine })}>{engine === "openrouter" ? "OpenRouter" : "Cloudflare pool"}</Button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">{(["text", "image"] as const).map((kind) => <label key={kind} className="text-sm space-y-1"><span>{kind === "text" ? "Text model · Nemotron Lightning" : "Image model · Nemotron VL"}</span><select aria-label={`${kind} build model`} className="w-full border rounded-md bg-background p-2 text-xs" value={settings[kind] ? `${settings[kind]?.provider}|${settings[kind]?.model}` : ""} onChange={(e) => setSettings({ ...settings, [kind]: pick(e.target.value) })}><option value="">Select manually</option>{options.filter((r) => kind === "text" || r.vision).map((r) => <option key={`${r.provider}|${r.model}`} value={`${r.provider}|${r.model}`}>{r.label} · {r.providerLabel}</option>)}</select></label>)}</div>
    <label className="flex flex-wrap items-center gap-3 text-sm">Chat helper<select aria-label="Chat engine" className="border rounded-md bg-background p-2" value={settings.chatEngine} onChange={(e) => setSettings({ ...settings, chatEngine: e.target.value })}><option value="openrouter">OpenRouter</option><option value="ollama">Previous Ollama setup</option></select></label>
    <Button disabled={busy} onClick={async () => { setBusy(true); try { await save({ data: { ...settings, chatEngine: settings.chatEngine as "openrouter" | "ollama" } }); toast.success("Saved for new builds"); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }}>Save</Button>
    <p className="text-xs text-muted-foreground">Planning: Cloudflare only. Running builds keep their starting engine.</p>
  </section>;
}