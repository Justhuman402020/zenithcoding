import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addProviderKey,
  getModelBoard,
  removeProviderKey,
  setActiveModel,
  setAutoFallback,
  testProviderConnection,
} from "@/lib/admin-models.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Cpu,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  KeyRound,
  PlusCircle,
  Trash2,
} from "lucide-react";



export const Route = createFileRoute("/_authenticated/admin/models")({
  head: () => ({
    meta: [
      { title: "AI models — Forge Admin" },
      { name: "description", content: "Switch the coding model Forge uses and watch free-tier limits per provider." },
      { property: "og:title", content: "AI models — Forge Admin" },
      { property: "og:description", content: "Switch coding models and watch free-tier limits per provider." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminModelsPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive flex items-center gap-2">
      <ShieldAlert className="h-4 w-4" /> {error.message}
    </div>
  ),
});

function statusTone(status: string | null) {
  if (status === "ok") return "text-emerald-500";
  if (status === "rate_limited") return "text-amber-500";
  if (status === "unauthorized" || status === "unavailable") return "text-destructive";
  return "text-muted-foreground";
}

function statusLabel(status: string | null) {
  if (status === "ok") return "Working";
  if (status === "rate_limited") return "Limit reached";
  if (status === "unauthorized") return "Key rejected";
  if (status === "unavailable") return "Unavailable";
  return "Not used yet";
}

function AdminModelsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ label: "", baseUrl: "", apiKey: "" });
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const board = useServerFn(getModelBoard);
  const choose = useServerFn(setActiveModel);
  const toggleFallback = useServerFn(setAutoFallback);
  const testKey = useServerFn(testProviderConnection);
  const addKey = useServerFn(addProviderKey);
  const removeKey = useServerFn(removeProviderKey);


  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "model-board"],
    queryFn: () => board({}),
  });

  async function onTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const res = await testKey({ data: { baseUrl: form.baseUrl, apiKey: form.apiKey } });
      setTestResult(res.ok ? `Works — ${res.modelCount} models found` : `Did not work — ${res.error}`);
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Could not test that key");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    setBusy("save");
    try {
      const res = await addKey({ data: form });
      toast.success(`${res.label} saved — ${res.modelCount} models added`);
      setForm({ label: "", baseUrl: "", apiKey: "" });
      setTestResult(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that key");
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(id: string, label: string) {
    try {
      await removeKey({ data: { id } });
      toast.success(`${label} removed`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  }


  async function activate(provider: string, model: string, label: string) {
    try {
      await choose({ data: { provider, model } });
      toast.success(`Now coding with ${label}`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch model");
    }
  }

  async function onToggleFallback(enabled: boolean) {
    try {
      await toggleFallback({ data: { enabled } });
      toast.success(enabled ? "Auto switching on" : "Auto switching off");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  const groups = new Map<string, NonNullable<typeof data>["rows"]>();
  for (const row of data?.rows ?? []) {
    if (query && !`${row.label} ${row.model}`.toLowerCase().includes(query.toLowerCase())) continue;
    const list = groups.get(row.provider) ?? [];
    list.push(row);
    groups.set(row.provider, list);
  }
  const summaries = new Map((data?.providers ?? []).map((p) => [p.provider, p]));


  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-6">
      <button
        onClick={() => navigate({ to: "/admin" })}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <ArrowLeft className="h-3 w-3" /> Back to admin
      </button>

      <div className="flex items-start gap-3">
        <Cpu className="h-6 w-6 text-primary mt-1" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">AI model board</h1>
          <p className="text-sm text-muted-foreground">
            Pick the model Forge codes with. If it runs out, Forge automatically moves to the next working model so your
            build never stops.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          {isRefetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-xl border p-4">
        <div>
          <div className="font-medium text-sm">Automatic switching</div>
          <div className="text-xs text-muted-foreground">Keeps jobs running when a model hits its free limit.</div>
        </div>
        <Button
          variant={data?.autoFallback ? "default" : "outline"}
          size="sm"
          onClick={() => onToggleFallback(!data?.autoFallback)}
        >
          {data?.autoFallback ? "On" : "Off"}
        </Button>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4 text-primary" />
          <div className="font-medium text-sm">Add a new key</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Type the website name, paste its address and your API key, then press Test. If it works, save it and its
          models join the list below and the automatic switching straight away. You can add as many keys as you like —
          even two or more from the same service (e.g. two Groq keys or several Hugging Face tokens). Each key gets
          its own row with its own models and limits. Using Hugging Face? Tap the button below — it fills the address
          for you, then paste your access token (starts with <code>hf_</code>).
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "LLM7", baseUrl: "https://api.llm7.io/v1" },
            { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
            { label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
            { label: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai" },
            { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
            { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
            { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" },
            { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
            { label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1" },
            { label: "Together", baseUrl: "https://api.together.xyz/v1" },
            { label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1" },
          ].map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setForm((f) => ({ ...f, label: preset.label, baseUrl: preset.baseUrl }))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="Name (e.g. Hugging Face)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Input placeholder="https://router.huggingface.co/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <Input placeholder="Paste API key or hf_ access token" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onTest} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test key"}
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save & activate"}
          </Button>
          {testResult ? <span className="text-xs text-muted-foreground">{testResult}</span> : null}
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every model on your keys…"
      />





      {isLoading ? (
        <div className="py-16 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {[...new Set([...summaries.keys(), ...groups.keys()])].map((providerId) => {
            const rows = groups.get(providerId) ?? [];
            const summary = summaries.get(providerId);
            const expanded = open[providerId] ?? false;
            const visible = expanded || query ? rows : rows.slice(0, 6);
            return (
            <div key={providerId} className="rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 gap-3">
                <div className="min-w-0">
                  <span className="font-semibold text-sm">{summary?.providerLabel ?? providerId}</span>
                  <div className="text-[11px] text-muted-foreground">
                    {summary?.modelCount ?? rows.length} models on this key
                    {summary?.creditsRemaining != null
                      ? ` · $${summary.creditsRemaining.toFixed(2)} credit left`
                      : summary?.creditsUsed != null
                        ? ` · $${summary.creditsUsed.toFixed(2)} used`
                        : ""}
                    {summary?.creditsNote ? ` · ${summary.creditsNote}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      (summary?.keyConfigured ?? rows[0]?.keyConfigured) ? "text-emerald-500" : "text-destructive"
                    }`}
                  >
                    <KeyRound className="h-3 w-3" />{" "}
                    {(summary?.keyConfigured ?? rows[0]?.keyConfigured) ? "API key saved" : "No API key"}
                  </span>
                  {summary?.custom ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onRemove(providerId, summary.providerLabel)}
                      aria-label={`Remove ${summary.providerLabel}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="divide-y">
                {visible.map((row) => (

                  <div key={`${row.provider}:${row.model}`} className="p-4 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{row.label}</span>
                        <span className="text-[10px] rounded px-1.5 py-0.5 border text-muted-foreground">
                          {row.role === "coding+images" ? "coding + understands images" : "coding only"}
                        </span>
                        {row.free ? (
                          <span className="text-[10px] rounded px-1.5 py-0.5 border border-emerald-500/40 text-emerald-500">
                            free
                          </span>
                        ) : null}
                        {row.lightweight ? (
                          <span className="text-[10px] rounded px-1.5 py-0.5 border text-muted-foreground">
                            lightweight
                          </span>
                        ) : null}
                        {row.codingRank ? (
                          <span className="text-[10px] rounded px-1.5 py-0.5 border border-primary/40 text-primary">
                            coding #{row.codingRank}
                          </span>
                        ) : null}
                        {row.imageRank ? (
                          <span className="text-[10px] rounded px-1.5 py-0.5 border text-muted-foreground">
                            image questions #{row.imageRank}
                          </span>
                        ) : null}

                        {row.active ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{row.hint}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                        <span className={statusTone(row.lastStatus)}>{statusLabel(row.lastStatus)}</span>
                        <span className="text-muted-foreground">
                          {row.remainingRequests != null
                            ? `${row.remainingRequests}${row.limitRequests ? ` / ${row.limitRequests}` : ""} requests left`
                            : "Usage not reported by this provider"}
                        </span>
                        {row.resetAt ? (
                          <span className="text-muted-foreground">
                            resets {new Date(row.resetAt).toLocaleTimeString()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={row.active ? "secondary" : "outline"}
                      disabled={row.active || !row.keyConfigured}
                      onClick={() => activate(row.provider, row.model, row.label)}
                    >
                      {row.active ? "In use" : "Use this"}
                    </Button>
                  </div>
                ))}
              </div>
              {rows.length > visible.length || (expanded && !query) ? (
                <button
                  className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground border-t"
                  onClick={() => setOpen((prev) => ({ ...prev, [providerId]: !expanded }))}
                >
                  {expanded ? "Show fewer models" : `Show all ${rows.length} models`}
                </button>
              ) : null}
            </div>
            );
          })}
        </div>

      )}
    </div>
  );
}
