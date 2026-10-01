import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FlaskConical, Loader2, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getCloudflarePool,
  moveCloudflareKey,
  removeProviderKey,
  testSavedProviderKey,
} from "@/lib/admin-models.functions";

function useCountdown(target?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return "--:--:--";
  const s = Math.max(0, Math.floor((Date.parse(target) - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function useCloudflarePool() {
  const load = useServerFn(getCloudflarePool);
  return useQuery({ queryKey: ["cf-pool"], queryFn: () => load(), refetchInterval: 30_000 });
}

/** Small bar: "X / 210,000 Neurons · resets in 05:12:09". Hidden for non-admins or no keys. */
export function NeuronsBar({ className = "" }: { className?: string }) {
  const { data } = useCloudflarePool();
  const countdown = useCountdown(data?.resetAt);
  if (!data || data.keys.length === 0) return null;
  const active = data.keys.find((k) => k.status === "active");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground ${className}`}
      title="Cloudflare Neurons used today across all keys, out of the daily total. Resets at 00:00 UTC (01:00 Lagos)."
    >
      <Zap className="h-3 w-3 text-primary" />
      <span className="tabular-nums text-foreground">{data.totalUsed.toLocaleString()}</span> used /
      <span className="tabular-nums">{data.totalLimit.toLocaleString()}</span> Neurons
      <span className="tabular-nums text-foreground">· {data.totalRemaining.toLocaleString()} left</span>
      {active ? <span>· Key #{active.position}</span> : <span className="text-destructive">· all used</span>}
      <span className="tabular-nums">· resets {countdown}</span>
    </span>
  );
}

const TONE = {
  active: "bg-primary/15 text-primary",
  waiting: "bg-muted text-muted-foreground",
  exhausted: "bg-destructive/15 text-destructive",
} as const;

export function CloudflarePoolPanel() {
  const { data, refetch, isLoading } = useCloudflarePool();
  const countdown = useCountdown(data?.resetAt);
  const move = useServerFn(moveCloudflareKey);
  const remove = useServerFn(removeProviderKey);
  const test = useServerFn(testSavedProviderKey);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Cloudflare keys pool
          </h2>
          <p className="text-xs text-muted-foreground">
            Unlimited keys (new ones join the end of the line), 10,000 Neurons each per day. Forge codes with Qwen on key #1 and moves to
            the next key when one runs out. Add keys with "Add a new key" → Cloudflare Workers AI.
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums">
            {(data?.totalUsed ?? 0).toLocaleString()} used
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {(data?.totalRemaining ?? 0).toLocaleString()} left of {(data?.totalLimit ?? 0).toLocaleString()} Neurons · resets in {countdown}
          </div>
        </div>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !data || data.keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Cloudflare keys yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.keys.map((k, i) => (
            <li key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="w-8 font-mono text-muted-foreground">#{k.position}</span>
              <span className="flex-1 min-w-[8rem] truncate">{k.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${TONE[k.status]}`}>{k.status}</span>
              <span className="tabular-nums text-xs text-muted-foreground w-36 text-right">
                {k.used.toLocaleString()} used · {k.remaining.toLocaleString()} left
              </span>
              <span
                className="text-[10px] text-muted-foreground"
                title={(k as any).source === "cloudflare" ? "Real count read from Cloudflare" : "Cloudflare didn't share the count for this key (needs Account Analytics: Read). Showing Forge's estimate."}
              >
                {(k as any).source === "cloudflare" ? "live" : "est."}
              </span>
              <Button size="icon" variant="ghost" disabled={!!busy || i === 0} onClick={() => act(k.id, () => move({ data: { id: k.id, direction: "up" } }))} title="Move up">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" disabled={!!busy || i === data.keys.length - 1} onClick={() => act(k.id, () => move({ data: { id: k.id, direction: "down" } }))} title="Move down">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!!busy}
                title="Test key"
                onClick={() =>
                  act(k.id, async () => {
                    const r = await test({ data: { id: k.id } });
                    r.ok ? toast.success(`Key #${k.position} works — ${r.modelCount} models`) : toast.error(`Key #${k.position}: ${r.error}`);
                  })
                }
              >
                {busy === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive"
                disabled={!!busy}
                title="Delete key"
                onClick={() => {
                  if (!confirm(`Delete Cloudflare key #${k.position} (${k.label})?`)) return;
                  void act(k.id, () => remove({ data: { id: k.id } }));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
