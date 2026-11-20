import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getProjectBackend,
  saveProjectBackend,
  testProjectBackend,
  useDefaultProjectBackend,
} from "@/lib/project-backend.functions";

export function BackendBadge({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(getProjectBackend);
  const test = useServerFn(testProjectBackend);
  const save = useServerFn(saveProjectBackend);
  const useDefault = useServerFn(useDefaultProjectBackend);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ projectUrl: "", anonKey: "", serviceKey: "" });

  const { data } = useQuery({
    queryKey: ["project-backend", projectId],
    queryFn: () => load({ data: { projectId } }),
    staleTime: 60_000,
  });
  const connected = !!data?.connected;
  const payload = {
    projectId,
    projectUrl: form.projectUrl.trim(),
    anonKey: form.anonKey.trim(),
    serviceKey: form.serviceKey.trim() || undefined,
  };
  const ready = payload.projectUrl.length > 8 && payload.anonKey.length > 10;
  const refresh = () => qc.invalidateQueries({ queryKey: ["project-backend", projectId] });

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Something went wrong";
      setMsg(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMsg(null);
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
          connected ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground"
        }`}
        title={connected ? `Backend: ${data?.url}` : "No backend — tap to connect"}
      >
        <Database className="h-3 w-3" />
        {compact ? (connected ? "Backend" : "No backend") : connected ? "Backend connected" : "No backend"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Backend for this project</DialogTitle>
            <DialogDescription>
              {connected
                ? `Connected to ${data?.url}. Signup, login and saved data go here. Paste new details below to switch.`
                : "Not connected. Paste your backend details, press Test, then Connect."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Project address (https://…supabase.co)" value={form.projectUrl} onChange={(e) => setForm({ ...form, projectUrl: e.target.value })} />
            <Input type="password" placeholder="Public key" value={form.anonKey} onChange={(e) => setForm({ ...form, anonKey: e.target.value })} />
            <Input type="password" placeholder="Private key (optional)" value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.target.value })} />
            {msg ? <p className="text-xs text-muted-foreground break-words">{msg}</p> : null}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={!ready || !!busy}
                onClick={() =>
                  run("test", async () => {
                    const r = await test({ data: payload });
                    setMsg(r.ok ? "It works. Press Connect to save." : r.error);
                    if (r.ok) toast.success("Connection works");
                  })
                }
              >
                {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Test
              </Button>
              <Button
                className="flex-1 bg-gold-gradient text-primary-foreground"
                disabled={!ready || !!busy}
                onClick={() =>
                  run("save", async () => {
                    await save({ data: payload });
                    toast.success("Backend connected to this project");
                    setForm({ projectUrl: "", anonKey: "", serviceKey: "" });
                    setOpen(false);
                    await refresh();
                  })
                }
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full text-xs"
              disabled={!!busy}
              onClick={() =>
                run("default", async () => {
                  const r = await useDefault({ data: { projectId } });
                  if (r.applied) {
                    toast.success("Using your saved default backend");
                    setOpen(false);
                    await refresh();
                  } else setMsg("No default backend is saved yet (admin → Backend).");
                })
              }
            >
              Use my saved default backend instead
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
