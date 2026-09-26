import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { searchGithubTemplates, remixGithubTemplate } from "@/lib/github-templates.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Sparkles, ArrowLeft, LayoutGrid, Star, Search, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Template Gallery — Forge" },
      { name: "description", content: "Browse hundreds of live GitHub templates and remix any of them into an editable project." },
      { property: "og:title", content: "Template Gallery — Forge" },
      { property: "og:description", content: "Browse live GitHub templates and remix them in one click." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatesPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">Templates error: {error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const TABS = [
  { id: "all", label: "All" },
  { id: "landing", label: "Landing Pages" },
  { id: "dashboard", label: "Dashboards" },
  { id: "saas", label: "SaaS" },
  { id: "portfolio", label: "Portfolios" },
  { id: "ecommerce", label: "E-Commerce" },
] as const;

function TemplatesPage() {
  const search = useServerFn(searchGithubTemplates);
  const remix = useServerFn(remixGithubTemplate);
  const navigate = useNavigate();
  const [category, setCategory] = useState<(typeof TABS)[number]["id"]>("all");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(draft.trim()), 500);
    return () => clearTimeout(t);
  }, [draft]);

  const q = useInfiniteQuery({
    queryKey: ["gh-templates", category, query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => search({ data: { category, query, page: pageParam } }),
    getNextPageParam: (last, all) =>
      last.ok && last.items.length === 100 && all.length < 10 && all.length * 100 < last.total ? all.length + 1 : undefined,
    staleTime: 5 * 60_000,
  });

  const pages = q.data?.pages ?? [];
  const seen = new Set<number>();
  const items = pages.flatMap((p) => p.items).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  const failure = pages.find((p) => !p.ok) as { message?: string } | undefined;

  async function onRemix(fullName: string, branch: string, description: string | null) {
    setPending(fullName);
    const id = toast.loading(`Copying ${fullName}… this can take up to a minute`);
    try {
      const res = await remix({ data: { fullName, branch, description } });
      toast.success(`Remix ready — ${res.files} files copied`, { id });
      await navigate({ to: "/p/$projectId", params: { projectId: res.projectId } });
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Failed to remix";
      if (/\b403\b|forbidden|rate limit/i.test(msg))
        msg = "GitHub blocked the copy. Wait a minute and try again, or check the saved GitHub token in Admin → Integrations.";
      toast.error(msg, { id });
      if (/unauthorized|no authorization|invalid token/i.test(msg)) navigate({ to: "/auth" });
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
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        <p className="text-sm text-muted-foreground">
          Live templates from GitHub. Pick one and remix it — you get your own copy to edit.
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search templates — try crypto, restaurant, blog…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={category === t.id ? "default" : "outline"}
              onClick={() => setCategory(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {failure?.message && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{failure.message}</div>
        )}

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((t) => (
              <div key={t.id} className="rounded-xl border overflow-hidden bg-card flex flex-col p-4">
                <div className="flex items-center gap-3">
                  <img src={t.avatar} alt={t.owner} className="h-9 w-9 rounded-full border" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{t.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.owner}</div>
                  </div>
                  <a href={t.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="View on GitHub">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <p className="text-sm text-muted-foreground mt-3 flex-1 line-clamp-3">{t.description ?? "No description."}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Star className="h-3 w-3" /> {t.stars.toLocaleString()}
                  </span>
                  {t.language && <span className="rounded-full bg-muted px-2 py-0.5">{t.language}</span>}
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">{t.category}</span>
                </div>
                <Button className="mt-3" onClick={() => onRemix(t.fullName, t.branch, t.description)} disabled={pending !== null}>
                  {pending === t.fullName ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                  Remix
                </Button>
              </div>
            ))}
            {items.length === 0 && !failure ? (
              <div className="col-span-full text-center text-muted-foreground py-16">No templates found. Try another word.</div>
            ) : null}
          </div>
        )}

        {q.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Load more ({items.length} shown)
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
