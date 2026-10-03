import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ExternalLink, FlaskConical, KeyRound, Loader2, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INTEGRATIONS, type IntegrationDef } from "@/lib/integrations-catalog";
import {
  listIntegrationKeys,
  removeIntegrationKey,
  saveIntegrationKey,
  testIntegrationKey,
} from "@/lib/admin-integrations.functions";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  head: () => ({
    meta: [
      { title: "Forge — Integrations & API keys" },
      { name: "description", content: "Save and test keys for Unsplash, OpenRouter, Tavily, GitHub, E2B and Neon." },
      { property: "og:title", content: "Forge — Integrations & API keys" },
      { property: "og:description", content: "Save and test keys for outside services." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

type Saved = Record<string, Record<string, { masked: string; updatedAt: string }>>;

function IntegrationsPage() {
  const navigate = useNavigate();
  const load = useServerFn(listIntegrationKeys);
  const { data, refetch, isLoading } = useQuery({ queryKey: ["admin-integrations"], queryFn: () => load() });
  const saved: Saved = (data as any)?.saved ?? {};

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin" })} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Admin
        </Button>
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-primary" /> Integrations &amp; API keys
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste a key, press the test icon to check it works, then Save. Saved keys stay hidden and encrypted.
          </p>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-4">
            {INTEGRATIONS.map((def) => (
              <ServiceCard key={def.id} def={def} saved={saved[def.id] ?? {}} onChanged={() => void refetch()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceCard({
  def,
  saved,
  onChanged,
}: {
  def: IntegrationDef;
  saved: Record<string, { masked: string }>;
  onChanged: () => void;
}) {
  const test = useServerFn(testIntegrationKey);
  const save = useServerFn(saveIntegrationKey);
  const remove = useServerFn(removeIntegrationKey);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isSaved = Object.keys(saved).length > 0;

  async function run(kind: "test" | "save" | "remove") {
    setBusy(kind);
    try {
      if (kind === "test") {
        const r = await test({ data: { service: def.id, values } });
        setResult(r);
      } else if (kind === "save") {
        const r = await save({ data: { service: def.id, values } });
        if (r.ok) {
          toast.success(`${def.name} key saved`);
          setValues({});
          onChanged();
        } else toast.error(r.message);
      } else {
        await remove({ data: { service: def.id } });
        toast.success(`${def.name} key removed`);
        setResult(null);
        onChanged();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium flex items-center gap-2">
            {def.name}
            {isSaved ? (
              <span className="text-[11px] rounded-full bg-primary/15 text-primary px-2 py-0.5">Saved</span>
            ) : (
              <span className="text-[11px] rounded-full bg-muted text-muted-foreground px-2 py-0.5">Not set</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{def.purpose}</div>
        </div>
        <a href={def.getUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1">
          Get key <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {def.fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {field.label}
            {!field.required && " (optional)"}
            {saved[field.key] && <span className="ml-2 text-foreground/70">saved: {saved[field.key].masked}</span>}
          </label>
          <Input
            type="password"
            autoComplete="off"
            value={values[field.key] ?? ""}
            placeholder={saved[field.key] ? "Leave empty to keep the saved key" : field.placeholder}
            onChange={(e) => {
              setResult(null);
              setValues((cur) => ({ ...cur, [field.key]: e.target.value }));
            }}
          />
        </div>
      ))}
      {result && (
        <div className={`text-xs flex items-start gap-1.5 ${result.ok ? "text-primary" : "text-destructive"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span className="break-all">{result.ok ? "Working — this key is valid." : result.message}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => run("test")} disabled={!!busy} className="gap-1.5" title="Test key">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Test
        </Button>
        <Button type="button" size="sm" onClick={() => run("save")} disabled={!!busy} className="gap-1.5">
          {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} {isSaved ? "Update" : "Save"}
        </Button>
        {isSaved && (
          <Button type="button" variant="ghost" size="sm" onClick={() => run("remove")} disabled={!!busy} className="ml-auto text-destructive gap-1.5">
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
