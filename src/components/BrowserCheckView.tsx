import { AlertTriangle, CheckCircle2, ImageOff, Loader2, Wrench } from "lucide-react";
import { findingsMessage, issueCount, type Findings } from "@/lib/browser-check-policy";

export type BrowserCheck =
  | { status: "running"; target: string }
  | { status: "done"; target: string; findings: Findings; shots: { label: string; url: string }[]; durationMs: number }
  | { status: "failed"; target: string; error: string; missingPermission: string[] };

export function BrowserCheckView({ check, onFix, fixBlockedReason }: { check: BrowserCheck | null; onFix?: (text: string) => void; fixBlockedReason?: string }) {
  if (!check) return <p className="text-muted-foreground">No browser test yet. Tap Test above the preview to run one.</p>;
  if (check.status === "running") {
    return (
      <div className="flex items-center gap-2 text-base text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening your {check.target === "published" ? "published site" : "preview"} in a real browser…
      </div>
    );
  }
  if (check.status === "failed") {
    return (
      <div className="space-y-3 text-base">
        <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> {check.error}</p>
        {check.missingPermission.length > 0 && (
          <div className="rounded-xl border border-border bg-card/70 p-3 text-sm">
            <p className="font-medium">These Cloudflare accounts can't open a test browser yet: {check.missingPermission.join(", ")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Sign in to Cloudflare with that account.</li>
              <li>Open My Profile → API Tokens and tap Edit on the token you saved in Code Haven.</li>
              <li>Tap "Add more", choose Account → <b>Browser Rendering</b> → <b>Edit</b>.</li>
              <li>Tap Continue to summary → Update token. The token text stays the same, so you don't need to paste anything again.</li>
            </ol>
          </div>
        )}
      </div>
    );
  }
  const n = issueCount(check.findings);
  const msg = findingsMessage(check.findings);
  return (
    <div className="space-y-4 text-base">
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${n ? "border-destructive/40" : "border-primary/40"}`}>
        {n ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
        <span>{n ? `${n} problem${n === 1 ? "" : "s"} found` : "Looks good: no broken pictures or page errors"}</span>
        <span className="ml-auto text-sm text-muted-foreground">{check.findings.imageCount} pictures · {(check.durationMs / 1000).toFixed(0)}s</span>
      </div>
      {n > 0 && (
        <>
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-card/70 p-3 text-sm">{msg}</pre>
          {onFix && (
            fixBlockedReason
              ? <p className="text-sm text-muted-foreground">{fixBlockedReason}</p>
              : (
                <button onClick={() => onFix(msg)} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  <Wrench className="h-4 w-4" /> Fix these
                </button>
              )
          )}
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {check.shots.map((s) => (
          <figure key={s.label} className="overflow-hidden rounded-xl border border-border bg-card/70">
            {s.url ? <img src={s.url} alt={`${s.label} screenshot`} className="w-full" loading="lazy" /> : <div className="flex h-40 items-center justify-center text-muted-foreground"><ImageOff className="h-5 w-5" /></div>}
            <figcaption className="px-3 py-2 text-sm text-muted-foreground">{s.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
