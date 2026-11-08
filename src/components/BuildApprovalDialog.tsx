import { useEffect, useState } from "react";
import { Cloud, Image as ImageIcon, Code2 } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/ProviderIcon";

export type ApprovalKind = "openrouter" | "openrouter-image" | "cloudflare" | "revert";
type Pending = { kind: ApprovalKind; message: string; resolve: (ok: boolean) => void };

let open: ((p: Pending) => void) | null = null;

/** Shows the Code Haven approval card; resolves true on Approve, false on Deny/close. */
export function requestApproval(kind: ApprovalKind, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!open) return resolve(window.confirm(message));
    open({ kind, message, resolve });
  });
}

const BADGE: Record<ApprovalKind, string> = { openrouter: "OpenRouter", "openrouter-image": "OpenRouter image", cloudflare: "Cloudflare", revert: "History" };

export function BuildApprovalHost() {
  const [p, setP] = useState<Pending | null>(null);
  useEffect(() => { open = setP; return () => { open = null; }; }, []);
  const done = (ok: boolean) => { p?.resolve(ok); setP(null); };
  return (
    <AlertDialog open={!!p} onOpenChange={(o) => { if (!o) done(false); }}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl border-border/60 bg-card/95 p-6 shadow-2xl backdrop-blur-xl" onEscapeKeyDown={() => done(false)}>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Code2 className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-lg font-semibold tracking-tight">Code Haven</AlertDialogTitle>
          {p && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              {p.kind === "cloudflare" ? <Cloud className="h-3.5 w-3.5" /> : p.kind === "revert" ? null : <ProviderIcon provider="openrouter" className="h-3.5 w-3.5" />}
              {p.kind === "openrouter-image" && <ImageIcon className="h-3.5 w-3.5" />}
              {BADGE[p.kind]}
            </span>
          )}
          <AlertDialogDescription className="text-sm text-foreground/90">{p?.message}</AlertDialogDescription>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => done(false)}>Deny</Button>
          <Button className="h-11 rounded-xl" onClick={() => done(true)} autoFocus>Approve</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
