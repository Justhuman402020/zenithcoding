import { cn } from "@/lib/utils";

export type SiteStatus = "published" | "pending" | "not_live";

const LABELS: Record<SiteStatus, string> = {
  published: "Published",
  pending: "Pending",
  not_live: "Not live",
};

const STYLES: Record<SiteStatus, string> = {
  published: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  not_live: "border-border/60 bg-muted/30 text-muted-foreground",
};

export function StatusBadge({ status, className }: { status: SiteStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STYLES[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
