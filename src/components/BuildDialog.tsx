import { useEffect, useRef, useState } from "react";
import { buildInBrowser, isBuildable, type BuildFile, type BuildLog, type BuildResult } from "@/lib/browser-build";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Package, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  files: BuildFile[];
  // Called when the user confirms - either with built files, or null to publish source as-is.
  onDone: (built: BuildFile[] | null) => void;
  title?: string;
  actionLabel?: string;
};

export function BuildDialog({ open, onOpenChange, files, onDone, title = "Build & publish", actionLabel = "Publish" }: Props) {
  const [logs, setLogs] = useState<BuildLog[]>([]);
  const [state, setState] = useState<"idle" | "building" | "done" | "error">("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setLogs([]);
      setState("idle");
      setResult(null);
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const check = isBuildable(files);
    if (!check.buildable) {
      setLogs([
        {
          level: "info",
          message: `No build needed (${check.reason}). Publishing files as-is.`,
          ts: Date.now(),
        },
      ]);
      setState("done");
      return;
    }

    setState("building");
    setLogs([{ level: "info", message: "Starting in-browser build…", ts: Date.now() }]);
    (async () => {
      const r = await buildInBrowser(files, (log) => {
        setLogs((prev) => [...prev, log]);
      });
      setResult(r);
      setState(r.ok ? "done" : "error");
    })();
  }, [open, files]);

  const built = result && result.ok ? result.files : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Package className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Forge builds your source in your browser (no server compute) before shipping it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
            {logs.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Preparing…
              </div>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2",
                    l.level === "error" && "text-destructive",
                    l.level === "warn" && "text-amber-500",
                    l.level === "success" && "text-emerald-500",
                    l.level === "info" && "text-muted-foreground",
                  )}
                >
                  <span className="shrink-0 opacity-60">
                    {l.level === "error" ? "✗" : l.level === "success" ? "✓" : l.level === "warn" ? "!" : "›"}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{l.message}</span>
                </div>
              ))
            )}
          </div>

          {state === "error" && result && !result.ok && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">Build failed</div>
                <div className="mt-1 text-muted-foreground">
                  You can still publish the source as-is (visitors will see raw files), or close and fix the error.
                </div>
              </div>
            </div>
          )}

          {state === "done" && built && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>{built.length} file(s) ready.</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={state === "building"}>
            Cancel
          </Button>
          {state === "error" && (
            <Button type="button" variant="secondary" onClick={() => onDone(null)}>
              {actionLabel} source anyway
            </Button>
          )}
          {state === "done" && (
            <Button
              type="button"
              onClick={() => onDone(built)}
              className="bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow"
            >
              {actionLabel}
            </Button>
          )}
          {state === "building" && (
            <Button type="button" disabled className="bg-gold-gradient text-primary-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
