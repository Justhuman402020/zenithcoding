import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { verifyDomain } from "@/lib/domains.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Globe, Loader2, Trash2, CheckCircle2, Copy, RefreshCw } from "lucide-react";

type Domain = {
  id: string;
  hostname: string;
  verification_token: string;
  verified: boolean;
  last_check_error: string | null;
};

const hostRe = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

export function DomainsPanel({ projectId }: { projectId: string }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newHost, setNewHost] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const verify = useServerFn(verifyDomain);

  async function load() {
    const { data } = await supabase
      .from("project_domains")
      .select("id,hostname,verification_token,verified,last_check_error")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    setDomains((data ?? []) as Domain[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function addDomain(e: React.FormEvent) {
    e.preventDefault();
    const host = newHost.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!hostRe.test(host)) {
      toast.error("Enter a real domain like mysite.com or app.mysite.com");
      return;
    }
    setAdding(true);
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) { setAdding(false); return; }
    const { error } = await supabase.from("project_domains").insert({
      project_id: projectId,
      user_id: userRes.user.id,
      hostname: host,
    });
    setAdding(false);
    if (error) return toast.error(error.message.includes("duplicate") ? "That domain is already connected" : error.message);
    setNewHost("");
    load();
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
      if (res.verified) toast.success(`${d.hostname} is verified!`);
      else toast(res.message ?? "Not verified yet");
    } catch (e: any) {
      toast.error(e?.message ?? "Verification failed");
    } finally {
      setBusyId(null);
      load();
    }
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
        <Label htmlFor="newDomain" className="text-sm">Connect a custom domain</Label>
        <div className="flex gap-2">
          <Input
            id="newDomain"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder="mysite.com"
            className="h-10"
          />
          <Button type="submit" disabled={adding} className="h-10 shrink-0">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">You'll get DNS instructions after adding the domain.</p>
      </form>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : domains.length === 0 ? null : (
        <div className="space-y-3">
          {domains.map((d) => (
            <div key={d.id} className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-sm truncate">{d.hostname}</span>
                {d.verified ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Verified
                  </span>
                ) : (
                  <span className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    Pending
                  </span>
                )}
                <button
                  onClick={() => removeDomain(d.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {!d.verified && (
                <div className="space-y-2 text-xs">
                  <p className="text-muted-foreground">
                    Add this <strong className="text-foreground">TXT record</strong> at your domain registrar (e.g. GoDaddy, Namecheap, Cloudflare). Then tap <em>Verify now</em>.
                  </p>
                  <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5 font-mono">
                    <DnsRow label="Type" value="TXT" copy={copy} />
                    <DnsRow label="Name / Host" value={`_forge-verify.${d.hostname.split(".").slice(-2).join(".") === d.hostname ? "" : d.hostname.split(".").slice(0, -2).join(".") + "."}${d.hostname.split(".").slice(-2).join(".")}`} display={`_forge-verify${d.hostname.split(".").length > 2 ? "." + d.hostname.split(".").slice(0, -2).join(".") : ""}`} copy={copy} />
                    <DnsRow label="Value" value={d.verification_token} copy={copy} />
                  </div>
                  {d.last_check_error && (
                    <p className="text-[11px] text-muted-foreground italic">Last check: {d.last_check_error}</p>
                  )}
                </div>
              )}

              {d.verified && (
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>Domain ownership verified. To make your site load at <strong className="text-foreground">{d.hostname}</strong>, point it to this app with a <strong className="text-foreground">CNAME record</strong>:</p>
                  <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5 font-mono">
                    <DnsRow label="Type" value="CNAME" copy={copy} />
                    <DnsRow label="Name" value={d.hostname} copy={copy} />
                    <DnsRow label="Value" value={typeof window !== "undefined" ? window.location.hostname : "your-app.lovable.app"} copy={copy} />
                  </div>
                </div>
              )}

              <Button
                type="button"
                size="sm"
                variant={d.verified ? "outline" : "default"}
                onClick={() => runVerify(d)}
                disabled={busyId === d.id}
                className="w-full h-9 gap-1.5"
              >
                {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {d.verified ? "Re-check DNS" : "Verify now"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DnsRow({ label, value, display, copy }: { label: string; value: string; display?: string; copy: (t: string, l: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="flex-1 truncate text-foreground">{display ?? value}</span>
      <button
        type="button"
        onClick={() => copy(display ?? value, label)}
        className="p-1 text-muted-foreground hover:text-foreground"
        title="Copy"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}