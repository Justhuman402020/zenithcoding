import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { connectDomain, setPrimaryDomain, verifyDomain } from "@/lib/domains.functions";
import { normalizeHostname, STATUS_LABEL, type DomainStatus } from "@/lib/domain-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Globe, Loader2, Trash2, CheckCircle2, Copy, RefreshCw, Star } from "lucide-react";

type DnsRecord = { type: string; name: string; value: string };
type Domain = {
  id: string;
  hostname: string;
  verification_token: string;
  verified: boolean;
  status: string;
  ssl_status: string | null;
  dns_records: DnsRecord[] | null;
  is_primary: boolean;
  last_check_error: string | null;
};

const STEPS: DomainStatus[] = ["waiting_records", "verifying", "setting_up_ssl", "live"];

/** Registrars want the name relative to the domain: "www", "@", "_forge-verify". */
function relName(full: string, hostname: string) {
  const root = hostname.replace(/^www\./, "");
  if (full === root) return "@";
  return full.endsWith(`.${root}`) ? full.slice(0, -(root.length + 1)) : full;
}

export function DomainsPanel({ projectId }: { projectId: string }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newHost, setNewHost] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const verify = useServerFn(verifyDomain);
  const connect = useServerFn(connectDomain);
  const setPrimary = useServerFn(setPrimaryDomain);
  const domainsRef = useRef<Domain[]>([]);

  async function load() {
    const { data } = await supabase
      .from("project_domains")
      .select("id,hostname,verification_token,verified,status,ssl_status,dns_records,is_primary,last_check_error")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as unknown as Domain[];
    domainsRef.current = list;
    setDomains(list);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [projectId]);

  // Keep checking unfinished domains every 30 seconds while this screen is open.
  useEffect(() => {
    const t = setInterval(async () => {
      const pending = domainsRef.current.filter((d) => d.status !== "live" && d.status !== "failed" && normalizeHostname(d.hostname));
      if (!pending.length) return;
      for (const d of pending) await verify({ data: { domainId: d.id } }).catch(() => null);
      load();
    }, 30_000);
    return () => clearInterval(t);
  }, [projectId]);

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    const host = normalizeHostname(newHost);
    if (!host) {
      toast.error("Type the full domain with its ending, like mysite.com or www.mysite.xyz");
      return;
    }
    setAdding(true);
    try {
      const res = await connect({ data: { projectId, hostname: host } });
      if (!res.ok && res.message) toast.error(res.message);
      else toast.success(`${host} added. Copy the records below.`);
      setNewHost("");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not add domain");
    } finally {
      setAdding(false);
      load();
    }
  }

  async function removeDomain(id: string) {
    if (!confirm("Disconnect this domain?")) return;
    await supabase.from("project_domains").delete().eq("id", id);
    load();
  }

  async function runVerify(d: Domain) {
    setBusyId(d.id);
    try {
      const res = await verify({ data: { domainId: d.id } });
      if (res.live) toast.success(`${d.hostname} is live!`);
      else toast(res.message ?? "Not ready yet");
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function togglePrimary(d: Domain) {
    await setPrimary({ data: { domainId: d.id, primary: !d.is_primary } }).catch((e) => toast.error(e?.message));
    load();
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Could not copy"),
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={addDomain} className="space-y-2">
        <Label htmlFor="newDomain" className="text-xs uppercase tracking-wider text-muted-foreground">Connect a domain you bought</Label>
        <div className="flex gap-2">
          <Input id="newDomain" value={newHost} onChange={(e) => setNewHost(e.target.value)} placeholder="www.yourname.com" className="h-10 bg-background/40" />
          <Button type="submit" disabled={adding} className="h-10 shrink-0 bg-gold-gradient text-primary-foreground hover:opacity-95">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Tip: connect <span className="text-foreground">www.yourname.com</span>. Most domain shops can't point the bare name (yourname.com) with a CNAME, but they can forward it to www.</p>
      </form>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : domains.length === 0 ? (
        <p className="text-xs text-muted-foreground">No domains yet.</p>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => {
            const status = (STEPS.includes(d.status as DomainStatus) || d.status === "failed" ? d.status : "waiting_records") as DomainStatus;
            const stepIdx = STEPS.indexOf(status);
            const cname = (d.dns_records ?? []).find((r) => r.type === "CNAME");
            const cfTxt = (d.dns_records ?? []).filter((r) => r.type === "TXT");
            const valid = !!normalizeHostname(d.hostname);
            return (
              <div key={d.id} className="rounded-lg hairline-gold bg-card/40 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate">{d.hostname}</span>
                  <span className={`ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${status === "live" ? "bg-primary/15 text-primary" : status === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                    {status === "live" && <CheckCircle2 className="h-3 w-3" />} {STATUS_LABEL[status]}
                  </span>
                  <button onClick={() => togglePrimary(d)} className={`p-1.5 rounded-md ${d.is_primary ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} title={d.is_primary ? "Main address (tap to unset)" : "Make main address"}>
                    <Star className={`h-3.5 w-3.5 ${d.is_primary ? "fill-current" : ""}`} />
                  </button>
                  <button onClick={() => removeDomain(d.id)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {status !== "failed" && (
                  <ol className="flex gap-1">
                    {STEPS.map((s, i) => (
                      <li key={s} className="flex-1">
                        <div className={`h-1 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-muted"}`} />
                        <div className={`mt-1 text-[10px] ${i === stepIdx ? "text-foreground" : "text-muted-foreground"}`}>{STATUS_LABEL[s]}</div>
                      </li>
                    ))}
                  </ol>
                )}

                {!valid ? (
                  <p className="text-xs text-destructive">This name has no ending (like .com). Remove it and connect the full domain.</p>
                ) : status !== "live" ? (
                  <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground leading-relaxed">
                      <strong className="text-primary">Step 1:</strong> Open the DNS settings where you bought the domain (Namecheap: <em className="text-foreground">Advanced DNS</em>). Delete any old A record for this name.
                    </p>
                    <p className="text-muted-foreground leading-relaxed"><strong className="text-primary">Step 2:</strong> Add these records exactly. Code Haven checks every 30 seconds.</p>
                    {cname ? (
                      <DnsBlock title="CNAME — points your domain at Code Haven" rows={[["Type", "CNAME"], ["Name / Host", relName(d.hostname, d.hostname)], ["Value", cname.value], ["TTL", "Automatic"]]} copy={copy} />
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">Preparing your records… tap Check again in a moment.</p>
                    )}
                    <DnsBlock title="TXT — proves you own it" rows={[["Type", "TXT"], ["Name / Host", relName(`_forge-verify.${d.hostname}`, d.hostname)], ["Value", d.verification_token], ["TTL", "Automatic"]]} copy={copy} />
                    {cfTxt.map((r, i) => (
                      <DnsBlock key={i} title="TXT — turns on the padlock (SSL)" rows={[["Type", "TXT"], ["Name / Host", relName(r.name, d.hostname)], ["Value", r.value], ["TTL", "Automatic"]]} copy={copy} />
                    ))}
                    <p className="text-[11px] text-muted-foreground/80 italic leading-relaxed">Changes usually show up in 5–30 minutes, sometimes up to a day.</p>
                    {d.last_check_error && <p className="text-[11px] text-destructive/80 leading-relaxed">Last check: {d.last_check_error}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <CheckCircle2 className="inline h-3 w-3 text-primary mr-1" />
                    <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="text-foreground underline">{d.hostname}</a> is live and shows your latest published version.
                  </p>
                )}

                <Button type="button" size="sm" variant={status === "live" ? "outline" : "default"} onClick={() => runVerify(d)} disabled={busyId === d.id || !valid} className={`w-full h-9 gap-1.5 ${status === "live" ? "hairline-gold" : "bg-gold-gradient text-primary-foreground hover:opacity-95"}`}>
                  {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Check again
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DnsRow({ label, value, copy }: { label: string; value: string; copy: (t: string, l: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="flex-1 truncate text-foreground">{value}</span>
      <button type="button" onClick={() => copy(value, label)} className="p-1 text-muted-foreground hover:text-foreground" title="Copy">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}

function DnsBlock({ title, rows, copy }: { title: string; rows: Array<[string, string]>; copy: (t: string, l: string) => void }) {
  return (
    <div className="rounded-md hairline-gold bg-muted/20 p-2.5 space-y-1.5 font-mono">
      <div className="text-[10px] uppercase tracking-wider text-primary/80 font-sans font-medium mb-1">{title}</div>
      {rows.map(([label, value]) => (
        <DnsRow key={label} label={label} value={value} copy={copy} />
      ))}
    </div>
  );
}
