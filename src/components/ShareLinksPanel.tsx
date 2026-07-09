import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listShareLinks, createShareLink, revokeShareLink } from "@/lib/share-links.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Link2, Loader2, Plus, Copy, Ban, Eye } from "lucide-react";

export function ShareLinksPanel({ projectId }: { projectId: string }) {
  const list = useServerFn(listShareLinks);
  const create = useServerFn(createShareLink);
  const revoke = useServerFn(revokeShareLink);
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["share-links", projectId],
    queryFn: () => list({ data: { projectId } }),
  });
  const links = data?.links ?? [];

  async function make() {
    setCreating(true);
    try {
      const res = await create({ data: { projectId, label: label.trim() || undefined, days } });
      const url = `${window.location.origin}/share/${res.link.token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Link created & copied");
      setLabel(""); setDays(7); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["share-links", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function copy(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    toast.success("Link copied");
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this link? Anyone with it will lose access.")) return;
    try {
      await revoke({ data: { id } });
      toast.success("Revoked");
      qc.invalidateQueries({ queryKey: ["share-links", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="rounded-xl border p-5 space-y-4 bg-card/50">
      <div className="flex items-start gap-3">
        <Link2 className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">Preview share links</h2>
          <p className="text-sm text-muted-foreground">
            Give clients a read-only preview link — no sign-in needed. Expires automatically.
          </p>
        </div>
        {!showForm ? (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New link
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <div className="rounded-lg border bg-background/40 p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="share-label">Label (optional)</Label>
              <Input id="share-label" placeholder="Client review" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-days">Expires in (days)</Label>
              <Input
                id="share-days"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={creating}>Cancel</Button>
            <Button onClick={make} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Create link
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : links.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground text-center py-4">No share links yet.</p>
      ) : links.length > 0 ? (
        <div className="border rounded-md divide-y">
          {links.map((l) => {
            const expired = l.expires_at ? new Date(l.expires_at) < new Date() : false;
            const inactive = l.revoked || expired;
            return (
              <div key={l.id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{l.label || "Untitled link"}</span>
                    {l.revoked ? <Badge variant="destructive" className="text-[10px]">Revoked</Badge>
                      : expired ? <Badge variant="outline" className="text-[10px]">Expired</Badge>
                      : <Badge variant="secondary" className="text-[10px]">Active</Badge>}
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Eye className="h-2.5 w-2.5" /> {l.view_count}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    /share/{l.token} · {l.expires_at ? `expires ${new Date(l.expires_at).toLocaleDateString()}` : "no expiry"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!inactive ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copy(l.token)} title="Copy">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onRevoke(l.id)} title="Revoke">
                        <Ban className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}