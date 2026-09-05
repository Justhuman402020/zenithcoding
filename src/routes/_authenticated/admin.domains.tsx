import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  attachDomain,
  checkDomainDns,
  detachDomain,
  listProjectSites,
  setProjectPublished,
} from "@/lib/admin-domains.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, type SiteStatus } from "@/components/StatusBadge";
import { Loader2, Globe, ExternalLink, Trash2, RefreshCw, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/domains")({
  component: AdminDomains,
  head: () => ({
    meta: [
      { title: "Domains & live links — Forge admin" },
      { name: "description", content: "Publish Forge projects and connect custom domains." },
    ],
  }),
});

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Could not copy"),
  );
}

function AdminDomains() {
  const qc = useQueryClient();
  const list = useServerFn(listProjectSites);
  const publishFn = useServerFn(setProjectPublished);
  const attachFn = useServerFn(attachDomain);
  const detachFn = useServerFn(detachDomain);
  const dnsFn = useServerFn(checkDomainDns);

  const [search, setSearch] = useState("");
  const [domainDraft, setDomainDraft] = useState<Record<string, string>>({});
  const [dns, setDns] = useState<Record<string, any>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-project-sites"],
    queryFn: () => list(),
  });

  const publish = useMutation({
    mutationFn: (v: { projectId: string; published: boolean }) => publishFn({ data: v }),
    onSuccess: (r) => {
      toast.success(r.published ? "Site is live" : "Site unpublished");
      qc.invalidateQueries({ queryKey: ["admin-project-sites"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update"),
  });

  const attach = useMutation({
    mutationFn: (v: { projectId: string; hostname: string }) => attachFn({ data: v }),
    onSuccess: () => {
      toast.success("Domain added — now point its DNS records below");
      qc.invalidateQueries({ queryKey: ["admin-project-sites"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add domain"),
  });

  const detach = useMutation({
    mutationFn: (domainId: string) => detachFn({ data: { domainId } }),
    onSuccess: () => {
      toast.success("Domain disconnected");
      qc.invalidateQueries({ queryKey: ["admin-project-sites"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove"),
  });

  const projects = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p: any) =>
        (p.name ?? "").toLowerCase().includes(q) || (p.slug ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  async function runDnsCheck(hostname: string) {
    try {
      const r = await dnsFn({ data: { hostname } });
      setDns((cur) => ({ ...cur, [hostname]: r }));
    } catch (e: any) {
      toast.error(e?.message ?? "DNS lookup failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-3xl">
          <Globe className="h-6 w-6 text-primary" /> Domains &amp; live links
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publish any project, see its live link and connect a domain you bought.
        </p>
      </header>

      <Input
        placeholder="Search projects…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-5"
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
        </div>
      )}
      {error && <p className="text-sm text-destructive">{(error as any)?.message}</p>}

      <div className="space-y-4">
        {projects.map((p: any) => {
          const liveUrl = p.slug ? `/s/${p.slug}` : `/live/${p.id}`;
          return (
            <section key={p.id} className="rounded-xl border border-border/60 bg-card/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-medium">{p.name || "Untitled"}</h2>
                    <StatusBadge status={p.status as SiteStatus} />
                  </div>
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noopener"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {liveUrl} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={p.published ? "outline" : "default"}
                    disabled={publish.isPending}
                    onClick={() => publish.mutate({ projectId: p.id, published: !p.published })}
                  >
                    {p.published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="yourname.com"
                    value={domainDraft[p.id] ?? ""}
                    onChange={(e) => setDomainDraft((c) => ({ ...c, [p.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    disabled={attach.isPending || !(domainDraft[p.id] ?? "").trim()}
                    onClick={() =>
                      attach.mutate({ projectId: p.id, hostname: domainDraft[p.id] ?? "" })
                    }
                  >
                    Add
                  </Button>
                </div>

                {(p.domains ?? []).map((d: any) => {
                  const check = dns[d.hostname];
                  return (
                    <div key={d.id} className="rounded-lg border border-border/50 bg-muted/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-sm">{d.hostname}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => runDnsCheck(d.hostname)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Check DNS
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => detach.mutate(d.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                        {[
                          ["A", "@", "185.158.133.1"],
                          ["A", "www", "185.158.133.1"],
                          ["TXT", "_forge-verify", d.verification_token ?? "(pending)"],
                        ].map(([type, host, value]) => (
                          <div key={`${type}-${host}`} className="flex items-center gap-2">
                            <span className="w-10 shrink-0">{type}</span>
                            <span className="w-28 shrink-0">{host}</span>
                            <span className="truncate">{value}</span>
                            <button
                              type="button"
                              onClick={() => copy(String(value))}
                              className="ml-auto opacity-60 hover:opacity-100"
                              aria-label="Copy value"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {check && (
                        <p className="mt-2 text-xs">
                          Root:{" "}
                          <span className={check.rootOk ? "text-emerald-400" : "text-amber-400"}>
                            {check.rootOk ? "pointing at Forge" : "not pointing here yet"}
                          </span>{" "}
                          · www:{" "}
                          <span className={check.wwwOk ? "text-emerald-400" : "text-amber-400"}>
                            {check.wwwOk ? "ok" : "not set"}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
