import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { getNeuronLedger } from "@/lib/workspace.functions";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
export function NeuronLog({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const load = useServerFn(getNeuronLedger);
  const { data, error } = useQuery({ queryKey: ["neuron-ledger"], queryFn: () => load(), refetchInterval: 15000 });
  return <><Button variant="ghost" size="sm" title="Today's Neuron log" aria-label="Open Neuron log" onClick={() => setOpen(true)}><Zap className="h-4 w-4 shrink-0" />{children ?? <span className="text-xs ml-1">Chat {data?.totals.chat ?? 0} · Plan {data?.totals.plan ?? 0}</span>}</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full sm:max-w-2xl overflow-y-auto"><SheetHeader><SheetTitle>Today's Neuron log</SheetTitle></SheetHeader>
      <p className="my-4 text-xs text-muted-foreground">Token-based estimates; account totals are reconciled with Cloudflare analytics when available.</p>
      <div className="text-sm mb-4">Chat {data?.totals.chat ?? 0} · Plan {data?.totals.plan ?? 0} · Build {data?.totals.build ?? 0}</div>
      {error && <p className="text-destructive text-sm">Could not load the log.</p>}
      <div className="space-y-2">{data?.rows.map((r) => <div key={r.id} className="border-b py-2 text-xs"><div className="flex justify-between gap-3"><span>{new Date(r.created_at).toLocaleTimeString()} · {r.section} · step {r.step}</span><strong>{r.neurons} Neurons</strong></div><div className="break-words text-muted-foreground">Key #{r.key_number ?? "—"} · {r.model} · {r.source} · {r.status}</div><div className="mt-1 break-words">{r.action}</div></div>)}</div>
      {!data?.rows.length && !error && <p className="text-sm text-muted-foreground">No calls recorded today.</p>}
    </SheetContent></Sheet></>;
}