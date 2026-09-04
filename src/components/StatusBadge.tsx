import { Globe } from "lucide-react";

export type SiteStatus = "published" | "pending" | "not_live";

const MAP: Record<SiteStatus, { label: string; cls: string }> = {
  published: { label: "Published", cls: "bg-primary/15 text-primary border-primary/30" },
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  not_live: { label: "Not live", cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status }: { status: SiteStatus }) {
  const s = MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full border font-medium ${s.cls}`}
    >
      <Globe className="h-2.5 w-2.5" /> {s.label}
    </span>
  );
}
