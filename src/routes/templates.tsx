import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listTemplates, remixTemplate } from "@/lib/templates.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Sparkles, ArrowLeft, LayoutGrid } from "lucide-react";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Templates — Forge" },
      { name: "description", content: "One-click remix of production-ready starter templates." },
    ],
  }),
  component: TemplatesPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">Templates error: {error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function TemplatesPage() {
  const fetchTemplates = useServerFn(listTemplates);
  const remix = useServerFn(remixTemplate);
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["templates"], queryFn: () => fetchTemplates() });

  async function onRemix(templateId: string) {
    setPending(templateId);
    try {
      const res = await remix({ data: { templateId } });
      toast.success("Remix created");
      await navigate({ to: "/p/$projectId", params: { projectId: res.projectId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remix");
      if (e instanceof Error && /unauthorized|no authorization|invalid token/i.test(e.message)) {
        navigate({ to: "/auth" });
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" />
            <h1 className="font-semibold">Templates</h1>
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Dashboard
          </Link>
        </div>
      </header>
      <div className="max-w-6xl mx-auto p-6">
        <p className="text-sm text-muted-foreground mb-6">Pick a starter and remix it in one click — you get your own copy to edit.</p>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data ?? []).map((t) => (
              <div key={t.id} className="rounded-xl border overflow-hidden bg-card flex flex-col">
                <div className="aspect-video bg-gradient-to-br from-primary/10 to-primary/30 flex items-center justify-center text-2xl font-bold text-primary/80">
                  {t.name}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{t.name}</div>
                    {t.category ? <span className="text-xs text-muted-foreground">{t.category}</span> : null}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 flex-1">{t.description}</p>
                  <Button className="mt-3" onClick={() => onRemix(t.id)} disabled={pending !== null}>
                    {pending === t.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Remix
                  </Button>
                </div>
              </div>
            ))}
            {(data ?? []).length === 0 ? (
              <div className="col-span-full text-center text-muted-foreground py-16">No templates yet.</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}