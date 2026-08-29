import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { initiateTransfer, listMyTransfers, cancelTransfer } from "@/lib/transfers.functions";
import { supabase } from "@/integrations/supabase/client";
import { DomainsPanel } from "@/components/DomainsPanel";
import { SecretsPanel } from "@/components/SecretsPanel";
import { ShareLinksPanel } from "@/components/ShareLinksPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Copy, X, Globe, ExternalLink, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/p/$projectId/settings")({
  head: () => ({ meta: [{ title: "Project settings — Forge" }] }),
  component: SettingsPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function SettingsPage() {
  const { projectId } = Route.useParams();
  const initiate = useServerFn(initiateTransfer);
  const list = useServerFn(listMyTransfers);
  const cancel = useServerFn(cancelTransfer);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [published, setPublished] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [publishing, setPublishing] = useState(false);

  const { data: transfers = [], refetch } = useQuery({
    queryKey: ["transfers", projectId],
    queryFn: () => list({ data: { projectId } }),
  });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("name,published,slug")
        .eq("id", projectId)
        .maybeSingle();
      if (!data) return;
      setProjectName(data.name);
      setPublished(!!data.published);
      setSlug(data.slug ?? "");
      setSlugDraft(data.slug ?? suggestSlug(data.name, projectId));
    })();
  }, [projectId]);

  const publicUrl = useMemo(() => {
    if (typeof window === "undefined" || !slug) return "";
    return `${window.location.origin}/s/${slug}`;
  }, [slug]);

  async function publish() {
    const cleanSlug = normalizeSlug(slugDraft);
    if (cleanSlug.length < 3) {
      toast.error("URL name must be at least 3 characters");
      return;
    }
    setPublishing(true);
    try {
      if (cleanSlug !== slug) {
        const { data: clash } = await supabase
          .from("projects")
          .select("id")
          .eq("slug", cleanSlug)
          .neq("id", projectId)
          .maybeSingle();
        if (clash) {
          toast.error("That URL name is taken. Try another one.");
          return;
        }
      }
      const { error } = await supabase.from("projects").update({ slug: cleanSlug, published: true }).eq("id", projectId);
      if (error) throw error;
      setSlug(cleanSlug);
      setPublished(true);
      toast.success("Site published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    setPublishing(true);
    try {
      const { error } = await supabase.from("projects").update({ published: false }).eq("id", projectId);
      if (error) throw error;
      setPublished(false);
      toast.success("Site unpublished");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not unpublish");
    } finally {
      setPublishing(false);
    }
  }

  async function send() {
    if (!email) return;
    setPending(true);
    try {
      const res = await initiate({ data: { projectId, toEmail: email } });
      toast.success(`Invitation created — share this link with ${res.to_email}`);
      await navigator.clipboard.writeText(res.acceptUrl).catch(() => {});
      setEmail("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create transfer");
    } finally {
      setPending(false);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/transfers/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  async function onCancel(id: string) {
    await cancel({ data: { transferId: id } });
    toast.success("Cancelled");
    refetch();
  }

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-10 space-y-6">
      <Link to="/p/$projectId" params={{ projectId }} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> Back to project
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Project settings</h1>
        <p className="text-sm text-muted-foreground">Publish {projectName || "this project"} and connect domains from Namecheap or any domain provider.</p>
      </div>

      <div className="rounded-xl border p-5 space-y-5 bg-card/50">
        <div className="flex items-start gap-3">
          <Globe className="h-5 w-5 text-primary mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Publish & domains</h2>
            <p className="text-sm text-muted-foreground">First publish the Forge link, then connect your domain.</p>
          </div>
          {published ? (
            <span className="inline-flex items-center gap-1 text-xs text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Live</span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="siteSlug">Forge URL name</Label>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-xs text-muted-foreground select-none">/s/</span>
            <Input
              id="siteSlug"
              value={slugDraft}
              onChange={(e) => setSlugDraft(normalizeSlug(e.target.value))}
              placeholder="my-site"
              className="border-0 bg-transparent px-0 focus-visible:ring-0 h-10"
            />
          </div>
        </div>

        {published && publicUrl ? (
          <div className="flex items-center gap-2 rounded-lg border bg-background/30 p-2">
            <span className="flex-1 truncate text-xs text-muted-foreground">{publicUrl}</span>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied"))}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : null}

        <div className="flex gap-2">
          {published ? <Button variant="outline" onClick={unpublish} disabled={publishing}>Unpublish</Button> : null}
          <Button onClick={publish} disabled={publishing} className="bg-gold-gradient text-primary-foreground shadow-gold-glow">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : published ? "Update publish" : "Publish site"}
          </Button>
        </div>

        <div className="border-t pt-4">
          <DomainsPanel projectId={projectId} />
        </div>
      </div>

      <AiModelPanel />
      <ShareLinksPanel projectId={projectId} />
      <SecretsPanel projectId={projectId} />

      <div className="rounded-xl border p-5 space-y-3">
        <div>
          <h2 className="font-semibold">Transfer ownership</h2>
          <p className="text-sm text-muted-foreground">
            Move this project to another user. They'll get a link to accept. You lose access once they accept.
          </p>
        </div>
        <div className="flex gap-2">
          <Input type="email" placeholder="recipient@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button onClick={send} disabled={pending || !email}>
            {pending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Send invite
          </Button>
        </div>

        {transfers.length > 0 ? (
          <div className="mt-4 border rounded-md divide-y">
            {transfers.map((t) => (
              <div key={t.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{t.to_email}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.status} · created {new Date(t.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {t.status === "pending" ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copyLink(t.token)} title="Copy invite link">
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onCancel(t.id)} title="Cancel">
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function suggestSlug(name: string, projectId: string): string {
  const base = normalizeSlug(name).slice(0, 32);
  return base.length >= 3 ? base : `site-${projectId.slice(0, 6)}`;
}