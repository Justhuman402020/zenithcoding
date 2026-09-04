import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  attachDomain,
  checkDomainDns,
  detachDomain,
  listProjectSites,
  setProjectPublished,
} from "@/lib/admin-domains.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/domains")({
  head: () => ({ meta: [{ title: "Forge — Domains & live links" }] }),
  component: AdminDomainsPage,
});

type DomainRow = {
  id: string;
  hostname: string;
  verified: boolean;
  verification_token: string;
  last_check_error: string | null;
};
type Site = {
  id: string;
  name: string;
  slug: string | null;
  published: boolean;
  status: "published" | "pending" | "not_live";
  domains: DomainRow[];
};

export function StatusBadge({ status }: { status: "published" | "pending" | "not_live" }) {
  const map = {
    published: { label: "Published", cls: "bg-primary/15 text-primary border-primary/30" },
    pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
    not_live: { label: "Not live", cls: "bg-muted text-muted-foreground border-border" },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-full border font-medium ${s.cls}`}
    >
      <Globe className="h-2.5 w-2.5" /> {s.label}
    </span>
  );
}

function AdminDomainsPage() {
  const navigate = useNavigate();
  const load = useServerFn(listProjectSites);
  const publishFn = useServerFn(setProjectPublished);
  const attachFn = useServerFn(attachDomain);
  const detachFn = useServerFn(detachDomain);
  const dnsFn = useServerFn(checkDomainDns);

  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [hostInput, setHostInput] = useState<Record<string, string>>({});
  const [dns, setDns] = useState<Record<string, any>>({});

  async function refresh() {
    try {
      const rows = (await load({})) as unknown as Site[];
      setSites(rows);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function togglePublish(site: Site) {
    setBusy(site.id);
    try {
      const res = await publishFn({ data: { projectId: site.id, published: !site.published } });
      setSites((prev) =>
        prev.map((s) =>
          s.id === site.id
            ? {
                ...s,
                published: res.published,
                slug: res.slug ?? s.slug,
                status: res.published ? "published" : res.slug ?? s.slug ? "pending" : "not_live",
              }
            : s,
        ),
      );
      toast.success(res.published ? "Project is live" : "Project unpublished");
    } catch (e: any) {
      toast.error(e?.message ?? "Publish failed");
    } finally {
      setBusy(null);
    }
  }

  async function addHost(site: Site) {
    const host = (hostInput[site.id] ?? "").trim();
    if (!host) return;
    setBusy(site.id);
    try {
      await attachFn({ data: { projectId: site.id, hostname: host } });
      setHostInput((p) => ({ ...p, [site.id]: "" }));
      toast.success("Domain connected — now add the DNS records");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add domain");
    } finally {
      setBusy(null);
    }
  }

  async function removeHost(domainId: string) {
    if (!confirm("Disconnect this domain?")) return;
    await detachFn({ data: { domainId } }).catch(() => null);
    refresh();
  }

  async function lookup(hostname: string) {
    setBusy(hostname);
    try {
      const res = await dnsFn({ data: { hostname } });
      setDns((p) => ({ ...p, [hostname]: res }));
      toast[res.rootOk ? "success" : "message"](
        res.rootOk ? `${hostname} points at Forge` : `${hostname} is not pointing here yet`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Lookup failed");
    } finally {
      setBusy(null);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy"),
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin" })} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Button>
          <h1 className="font-display text-xl">Domains & live links</h1>
        </div>

        {loading ? (
          <div className="py-16 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {sites.map((site) => {
              const liveById = `/live/${site.id}`;
              const liveBySlug = site.slug ? `/s/${site.slug}` : null;
              return (
                <div key={site.id} className="rounded-2xl hairline-gold bg-card/70 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{site.name}</span>
                    <StatusBadge status={site.status} />
                    <Button
                      size="sm"
                      variant={site.published ? "outline" : "default"}
                      disabled={busy === site.id}
                      onClick={() => togglePublish(site)}
                      className={`ml-auto h-8 gap-1.5 ${site.published ? "" : "bg-gold-gradient text-primary-foreground"}`}
                    >
                      {busy === site.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Rocket className="h-3.5 w-3.5" />
                      )}
                      {site.published ? "Unpublish" : "Publish"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs">
                    <a href={liveById} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> {liveById}
                    </a>
                    {liveBySlug && (
                      <a href={liveBySlug} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> {liveBySlug}
                      </a>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={hostInput[site.id] ?? ""}
                      onChange={(e) => setHostInput((p) => ({ ...p, [site.id]: e.target.value }))}
                      placeholder="yourname.com"
                      className="h-9 bg-background/40 text-sm"
                    />
                    <Button size="sm" className="h-9" disabled={busy === site.id} onClick={() => addHost(site)}>
                      Connect
                    </Button>
                  </div>

                  {site.domains.map((d) => {
                    const info = dns[d.hostname];
                    return (
                      <div key={d.id} className="rounded-lg border border-border bg-background/40 p-3 space-y-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-medium truncate">{d.hostname}</span>
                          {d.verified && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                          <button
                            onClick={() => removeHost(d.id)}
                            className="ml-auto p-1 text-muted-foreground hover:text-destructive"
                            title="Disconnect"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="rounded-md bg-muted/20 p-2 font-mono space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-primary/80 font-sans">
                            CNAME — www subdomain
                          </div>
                          <Row label="Type" value="CNAME" onCopy={copy} />
                          <Row label="Host" value="www" onCopy={copy} />
                          <Row label="Value" value={info?.appHost ?? "zenithcoding.lovable.app"} onCopy={copy} />
                        </div>
                        <div className="rounded-md bg-muted/20 p-2 font-mono space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-primary/80 font-sans">
                            A record — root domain
                          </div>
                          <Row label="Type" value="A" onCopy={copy} />
                          <Row label="Host" value="@" onCopy={copy} />
                          <Row label="Value" value="185.158.133.1" onCopy={copy} />
                        </div>
                        <div className="rounded-md bg-muted/20 p-2 font-mono space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-primary/80 font-sans">
                            TXT — ownership check
                          </div>
                          <Row label="Host" value={`_forge-verify`} onCopy={copy} />
                          <Row label="Value" value={d.verification_token} onCopy={copy} />
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-8 gap-1.5"
                          disabled={busy === d.hostname}
                          onClick={() => lookup(d.hostname)}
                        >
                          {busy === d.hostname ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Live DNS lookup
                        </Button>

                        {info && (
                          <div className="space-y-0.5 text-[11px] text-muted-foreground">
                            <div>root A: {info.observed.aRoot.join(", ") || "none"} {info.rootOk ? "✓" : "✗"}</div>
                            <div>root CNAME: {info.observed.cnameRoot.join(", ") || "none"}</div>
                            <div>www: {[...info.observed.aWww, ...info.observed.cnameWww].join(", ") || "none"} {info.wwwOk ? "✓" : "✗"}</div>
                            <div>TXT: {info.observed.txt.join(", ") || "none"}</div>
                          </div>
                        )}
                        {d.last_check_error && <p className="text-[11px] text-destructive/80">{d.last_check_error}</p>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground w-14 shrink-0">{label}</span>
      <span className="flex-1 truncate text-foreground">{value}</span>
      <button type="button" onClick={() => onCopy(value)} className="p-1 text-muted-foreground hover:text-foreground">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
