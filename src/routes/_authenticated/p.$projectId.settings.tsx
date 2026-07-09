import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { initiateTransfer, listMyTransfers, cancelTransfer } from "@/lib/transfers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Copy, X } from "lucide-react";

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

  const { data: transfers = [], refetch } = useQuery({
    queryKey: ["transfers", projectId],
    queryFn: () => list({ data: { projectId } }),
  });

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
      <h1 className="text-2xl font-bold">Project settings</h1>

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