import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPoolSettings, savePoolSettings } from "@/lib/cf-pool.functions";
import { validateRunCap } from "@/lib/cf-pool-policy";

export function CloudflarePoolToggle() {
  const load = useServerFn(getPoolSettings);
  const save = useServerFn(savePoolSettings);
  const { data, refetch } = useQuery({ queryKey: ["cf-pool-settings"], queryFn: () => load() });
  const [cap, setCap] = useState("");
  const [editingCap, setEditingCap] = useState(false);
  useEffect(() => setCap(data?.cap ? String(data.cap) : ""), [data?.cap]);

  async function apply(next: { enabled: boolean; capEnabled: boolean; cap: number }) {
    if (next.capEnabled) {
      const check = validateRunCap(true, next.cap, data?.todayRemaining ?? null);
      if (!check.ok) return toast.error(check.error);
    }
    try {
      await save({ data: next });
      await refetch();
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  const enabled = !!data?.poolEnabled;
  const capEnabled = !!data?.capEnabled;
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-sm">Cloudflare pool</div>
          <div className="text-xs text-muted-foreground">
            Off: coding and images use the models you picked below, never Cloudflare, with a clear error if one is unavailable.
            On: coding runs on keys 1 → 60 in order, handing off at 9,000 Neurons. Images never use Cloudflare.
          </div>
        </div>
        <Button size="sm" variant={enabled ? "default" : "outline"} onClick={() => apply({ enabled: !enabled, capEnabled, cap: Number(cap) || 0 })}>
          {enabled ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <div className="flex-1 min-w-[12rem]">
          <div className="font-medium text-sm">Neuron cap for the next run</div>
          <div className="text-xs text-muted-foreground">
            A ceiling, not a reservation — only real use is recorded.
            {data?.todayRemaining != null ? ` Today's remaining: ${data.todayRemaining.toLocaleString()}.` : ""}
          </div>
        </div>
        {capEnabled || editingCap ? (
          <Input className="w-28" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 5000" />
        ) : null}
        {capEnabled || editingCap ? (
          <Button size="sm" variant="outline" onClick={() => { setEditingCap(false); apply({ enabled, capEnabled: true, cap: Number(cap) || 0 }); }}>Save cap</Button>
        ) : null}
        <Button
          size="sm"
          variant={capEnabled ? "default" : "outline"}
          onClick={() => {
            if (capEnabled) {
              setEditingCap(false);
              apply({ enabled, capEnabled: false, cap: 0 });
            } else {
              setEditingCap(true);
            }
          }}
        >
          {capEnabled ? "On" : "Off"}
        </Button>
      </div>
    </div>
  );
}
