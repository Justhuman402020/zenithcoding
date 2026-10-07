import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addProviderKey,
  getAiGateway,
  getModelBoard,
  removeProviderKey,
  saveAiGateway,
  setActiveModel,
  setAutoFallback,
  testAiGateway,
  testProviderConnection,
} from "@/lib/admin-models.functions";
import { Button } from "@/components/ui/button";
import { CloudflarePoolPanel, NeuronsBar } from "@/components/CloudflarePoolPanel";
import { CloudflareModelSettings } from "@/components/CloudflareModelSettings";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Cpu,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  Globe,
  KeyRound,
  PlusCircle,
  Trash2,
} from "lucide-react";



export const Route = createFileRoute("/_authenticated/admin/models")({
  head: () => ({
    meta: [
      { title: "AI models — Code Haven Admin" },
      { name: "description", content: "Switch the coding and image models Code Haven uses and watch free-tier limits per provider." },
      { property: "og:title", content: "AI models — Code Haven Admin" },
      { property: "og:description", content: "Switch coding models and watch free-tier limits per provider." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminModelsPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive flex items-center gap-2">
      <ShieldAlert className="h-4 w-4" /> {(error as Error).message}
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
  const CF_BASE = (id: string) => `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`;
  const PROVIDER_PRESETS: Array<{ label: string; baseUrl: string; tokenLabel?: string }> = [
    { label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1" },
    { label: "GitHub Models", baseUrl: "https://models.github.ai/inference", tokenLabel: "GitHub access token" },
    { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
    { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
    { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", tokenLabel: "Google AI Studio API key" },
    { label: "Custom API key", baseUrl: "", tokenLabel: "Paste API key" },
    { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
    { label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
    { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" },
    { label: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai" },
    { label: "LLM7", baseUrl: "https://api.llm7.io/v1" },
    {
      label: "Alibaba Cloud Model Studio",
      baseUrl: "https://ws-w68rj1chv3ty9eac.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      tokenLabel: "Alibaba Model Studio API key",
    },
    { label: "Cloudflare Workers AI", baseUrl: CF_BASE("ACCOUNT_ID"), tokenLabel: "Cloudflare API token" },
  ];
  const [form, setForm] = useState({ label: PROVIDER_PRESETS[0].label, baseUrl: PROVIDER_PRESETS[0].baseUrl, apiKey: "" });
  const [cfAccount, setCfAccount] = useState("");
  const selectedProvider = PROVIDER_PRESETS.find((provider) => provider.label === form.label) ?? PROVIDER_PRESETS[0];
  const isCloudflare = form.label === "Cloudflare Workers AI";
  const isCustom = form.label === "Custom API key";
  const [customName, setCustomName] = useState("");
  const [testedCount, setTestedCount] = useState<number | null>(null);
  const keyTooShort =
    form.apiKey.trim().length < 8 ||
    (isCloudflare && cfAccount.trim().length < 16) ||
    (isCustom && (customName.trim().length < 2 || !/^https?:\/\/.{3,}/.test(form.baseUrl.trim())));
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const board = useServerFn(getModelBoard);
  const choose = useServerFn(setActiveModel);
  const toggleFallback = useServerFn(setAutoFallback);
  const testKey = useServerFn(testProviderConnection);
  const addKey = useServerFn(addProviderKey);
  const removeKey = useServerFn(removeProviderKey);
  const loadGateway = useServerFn(getAiGateway);
  const saveGateway = useServerFn(saveAiGateway);
  const testGateway = useServerFn(testAiGateway);

  const DEFAULT_GATEWAY_URL =
    "https://gateway.ai.cloudflare.com/v1/d51370edd74081c6688d32ae7de5d8a7/code-haven";
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState<"test" | "save" | null>(null);
  const [gatewayResult, setGatewayResult] = useState<string | null>(null);

  const gatewayQuery = useQuery({
    queryKey: ["admin", "ai-gateway"],
    queryFn: () => loadGateway({}),
  });
  const gatewayLoaded = useRef(false);
  useEffect(() => {
    if (gatewayLoaded.current || !gatewayQuery.data) return;
    gatewayLoaded.current = true;
    setGatewayUrl(gatewayQuery.data.url ?? DEFAULT_GATEWAY_URL);
    setGatewayEnabled(gatewayQuery.data.enabled);
  }, [gatewayQuery.data]);

  async function onTestGateway() {
    setGatewayBusy("test");
    setGatewayResult(null);
    try {
      const res = await testGateway({ data: { url: gatewayUrl } });
      setGatewayResult(res.ok ? `Reachable — it answered (status ${res.status})` : `Not reachable — ${res.error}`);
    } catch (e) {
      setGatewayResult(e instanceof Error ? e.message : "Could not test that address");
    } finally {
      setGatewayBusy(null);
    }
  }

  async function onSaveGateway() {
    setGatewayBusy("save");
    try {
      await saveGateway({ data: { url: gatewayUrl, enabled: gatewayEnabled } });
      toast.success(gatewayUrl.trim() ? "Gateway saved" : "Gateway cleared");
      gatewayQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the gateway");
    } finally {
      setGatewayBusy(null);
    }
  }



  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "model-board"],
    queryFn: () => board({}),
  });

  async function onTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const res = await testKey({ data: { baseUrl: form.baseUrl, apiKey: form.apiKey } });
      setTestedCount(res.ok ? res.modelCount : null);
      setTestResult(res.ok ? `Works — ${res.modelCount} models available` : `Did not work — ${res.error}`);
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Could not test that key");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    setBusy("save");
    try {
      const res = await addKey({ data: { ...form, label: isCustom ? customName.trim() : form.label } });
      toast.success(`Saved — ${res.modelCount} models added`);
      setTestedCount(null);
      if (isCustom) setCustomName("");
      setForm({ label: selectedProvider.label, baseUrl: isCloudflare || isCustom ? (isCustom ? "" : form.baseUrl) : selectedProvider.baseUrl, apiKey: "" });
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

      <NeuronsBar />
      <CloudflarePoolPanel />
      <CloudflareModelSettings />

      <div className="flex items-start gap-3">
        <Cpu className="h-6 w-6 text-primary mt-1" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">AI model board</h1>
          <p className="text-sm text-muted-foreground">
            Pick the model Code Haven codes with. If it runs out, Code Haven automatically moves to the next working model so your
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">AI Gateway &amp; Proxy URL</div>
          </div>
          <Button
            variant={gatewayEnabled ? "default" : "outline"}
            size="sm"
            onClick={() => setGatewayEnabled(!gatewayEnabled)}
          >
            {gatewayEnabled ? "Enabled" : "Disabled"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          When enabled, requests to your providers (OpenRouter, Groq and the rest) go through this gateway address
          first. Turn it off or clear the box to talk to each provider directly.
        </p>
        <Input
          value={gatewayUrl}
          onChange={(e) => setGatewayUrl(e.target.value)}
          placeholder="https://gateway.ai.cloudflare.com/v1/…"
          aria-label="AI Gateway URL"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={onTestGateway}
            disabled={gatewayBusy !== null || gatewayUrl.trim().length < 8}
          >
            {gatewayBusy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test Gateway"}
          </Button>
          <Button size="sm" onClick={onSaveGateway} disabled={gatewayBusy !== null}>
            {gatewayBusy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setGatewayUrl("");
              setGatewayEnabled(false);
            }}
          >
            Clear
          </Button>
          {gatewayResult ? <span className="text-xs text-muted-foreground">{gatewayResult}</span> : null}
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4 text-primary" />
            <div className="font-medium text-sm">Connect a provider</div>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-primary">Admin only</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose a provider, paste your key, and we&apos;ll securely test it and load every model it makes available.
          Raw keys are never shown back in the browser.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            aria-label="AI provider"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={form.label}
            onChange={(e) => {
              const preset = PROVIDER_PRESETS.find((item) => item.label === e.target.value);
              setForm(preset ? { ...form, label: preset.label, baseUrl: preset.baseUrl } : { ...form, label: e.target.value });
              setTestResult(null);
              setTestedCount(null);
            }}
          >
            {PROVIDER_PRESETS.map((preset) => <option key={preset.label}>{preset.label}</option>)}
          </select>
          {isCloudflare ? (
            <Input
              placeholder="Cloudflare Account ID"
              value={cfAccount}
              onChange={(e) => {
                const id = e.target.value.trim();
                setCfAccount(id);
                setForm({ ...form, baseUrl: CF_BASE(id || "ACCOUNT_ID") });
              }}
              aria-label="Cloudflare Account ID"
            />
          ) : isCustom ? (
            <Input
              placeholder="Base URL, e.g. https://api.example.com/v1"
              value={form.baseUrl}
              onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); setTestedCount(null); }}
              aria-label="Provider API URL"
            />
          ) : (
            <Input value={form.baseUrl} readOnly aria-label="Provider API URL" />
          )}
          <Input
            placeholder={selectedProvider.tokenLabel ?? "Paste API key"}
            type="password"
            value={form.apiKey}
            onChange={(e) => { setForm({ ...form, apiKey: e.target.value }); setTestedCount(null); }}
            aria-label={selectedProvider.tokenLabel ?? "API key"}
          />
          {isCustom ? (
            <Input
              className="sm:col-span-3"
              placeholder="Name for this key (e.g. Together AI, My proxy)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              aria-label="Custom provider name"
            />
          ) : null}
        </div>
        {isCloudflare ? (
          <p className="text-xs text-muted-foreground">
            Paste your Account ID and an API token (the one starting with cfat_) that has the{" "}
            <span className="font-medium">Workers AI Read</span> permission. Add as many Cloudflare accounts as you like.
          </p>
        ) : form.label === "GitHub Models" ? (
          <p className="text-xs text-muted-foreground">
            GitHub uses a personal access token, not an API key. Create one at github.com/settings/personal-access-tokens
            and give it the <span className="font-medium">Models: read</span> permission.
          </p>
        ) : form.label === "Google AI Studio" ? (
          <p className="text-xs text-muted-foreground">
            Get a free key at aistudio.google.com/apikey, paste it, tap Test key to see how many Gemini models it unlocks, then save.
          </p>
        ) : isCustom ? (
          <p className="text-xs text-muted-foreground">
            Works with any OpenAI-style service. Paste its Base URL and key, tap Test key to count its models, then save.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={onTest} disabled={busy !== null || keyTooShort}>
            {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test connection"}
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy !== null || keyTooShort || (isCustom && testedCount === null)}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : testedCount !== null ? `Save ${testedCount} models` : "Save & activate"}
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
          {[...groups.entries()].map(([providerId, rows]) => {
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
                      rows[0]?.keyConfigured ? "text-emerald-500" : "text-destructive"
                    }`}
                  >
                    <KeyRound className="h-3 w-3" /> {rows[0]?.keyConfigured ? "API key saved" : "No API key"}
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
                        {/(mini|small|lite|flash|7b|8b|14b|20b|27b|free)/i.test(row.model) ? (
                          <span className="text-[10px] rounded px-1.5 py-0.5 border border-primary/40 text-primary">lightweight</span>
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
