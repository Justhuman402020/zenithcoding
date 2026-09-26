import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Database, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSupabaseConnection,
  saveSupabaseConnection,
  testSupabaseConnection,
  removeSupabaseConnection,
} from "@/lib/admin-supabase.functions";

export const Route = createFileRoute("/_authenticated/admin/backend")({
  head: () => ({
    meta: [
      { title: "Forge — Backend connection" },
      { name: "description", content: "Save the backend account every new Forge project uses for signup and data." },
      { property: "og:title", content: "Forge — Backend connection" },
      { property: "og:description", content: "Save the backend account every new Forge project uses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminBackendPage,
});

function AdminBackendPage() {
  const navigate = useNavigate();
  const load = useServerFn(getSupabaseConnection);
  const save = useServerFn(saveSupabaseConnection);
  const test = useServerFn(testSupabaseConnection);
  const remove = useServerFn(removeSupabaseConnection);

  const [form, setForm] = useState({ label: "", projectUrl: "", anonKey: "", serviceKey: "" });
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["admin", "backend-connection"],
    queryFn: () => load({}),
  });

  useEffect(() => {
    if (data?.connection) {
      setForm((f) => ({
        ...f,
        label: data.connection!.label ?? "",
        projectUrl: data.connection!.projectUrl,
      }));
    }
  }, [data]);

  const payload = {
    projectUrl: form.projectUrl.trim(),
    anonKey: form.anonKey.trim(),
    serviceKey: form.serviceKey.trim() || undefined,
    label: form.label.trim() || undefined,
  };
  const ready = payload.projectUrl.length > 8 && payload.anonKey.length > 10;

  async function handleTest() {
    setBusy("test");
    setResult(null);
    try {
      const res = await test({ data: payload });
      if (res.ok) {
        setResult(res.serviceOk ? "Connected. Public and private keys both work." : "Connected. Public key works.");
        toast.success("Connection works");
      } else {
        setResult(res.error ?? "Connection failed");
        toast.error(res.error ?? "Connection failed");
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Connection failed";
      setResult(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    try {
      await save({ data: payload });
      toast.success("Saved. New projects will use this backend.");
      setForm((f) => ({ ...f, anonKey: "", serviceKey: "" }));
      setResult(null);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await remove({});
      toast.success("Connection removed");
      setForm({ label: "", projectUrl: "", anonKey: "", serviceKey: "" });
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-4 text-center">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This page is for admins only.</p>
          <Button variant="outline" onClick={() => navigate({ to: "/admin" })} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to admin
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/admin" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-display text-xl flex items-center gap-2">
              <Database className="h-5 w-5" /> Backend connection
            </h1>
            <p className="text-xs text-muted-foreground">
              Every new project will use this account for signup, login and saved data.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {data?.connection ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm space-y-1">
                <div className="flex items-center gap-2 text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" /> Connected
                </div>
                <div className="text-muted-foreground break-all">{data.connection.projectUrl}</div>
                <div className="text-muted-foreground">Public key: {data.connection.anonMasked}</div>
                <div className="text-muted-foreground">
                  Private key: {data.connection.hasServiceKey ? "saved" : "not added"}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                No backend saved yet. Paste the details below, test them, then save.
              </div>
            )}

            <div className="rounded-xl border p-4 space-y-3">
              <label className="block text-xs text-muted-foreground">
                Name (optional)
                <Input
                  className="mt-1"
                  placeholder="Main backend"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Project address
                <Input
                  className="mt-1"
                  placeholder="https://yourproject.supabase.co"
                  value={form.projectUrl}
                  onChange={(e) => setForm({ ...form, projectUrl: e.target.value })}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Public key
                <Input
                  className="mt-1"
                  type="password"
                  placeholder="Paste the public (anon) key"
                  value={form.anonKey}
                  onChange={(e) => setForm({ ...form, anonKey: e.target.value })}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Private key (optional)
                <Input
                  className="mt-1"
                  type="password"
                  placeholder="Paste the private (service role) key"
                  value={form.serviceKey}
                  onChange={(e) => setForm({ ...form, serviceKey: e.target.value })}
                />
              </label>

              {result ? <p className="text-xs text-muted-foreground">{result}</p> : null}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" disabled={!ready || busy !== null} onClick={handleTest}>
                  {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test
                </Button>
                <Button
                  className="flex-1 gap-1.5 bg-gold-gradient text-primary-foreground"
                  disabled={!ready || busy !== null}
                  onClick={handleSave}
                >
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                </Button>
              </div>
              {data?.connection ? (
                <Button
                  variant="ghost"
                  className="w-full gap-1.5 text-destructive"
                  disabled={busy !== null}
                  onClick={handleRemove}
                >
                  <Trash2 className="h-4 w-4" /> Remove connection
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
