import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getTransferByToken, acceptTransfer } from "@/lib/transfers.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/transfers/$token")({
  head: () => ({ meta: [{ title: "Accept project transfer — Forge" }] }),
  component: TransferPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Transfer not found</div>,
});

function TransferPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const fetchTransfer = useServerFn(getTransferByToken);
  const accept = useServerFn(acceptTransfer);
  const [signedIn, setSignedIn] = useState<{ email?: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(data.user ? { email: data.user.email ?? undefined } : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(session?.user ? { email: session.user.email ?? undefined } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["transfer", token],
    queryFn: () => fetchTransfer({ data: { token } }),
  });

  async function onAccept() {
    setPending(true);
    try {
      const res = await accept({ data: { token } });
      toast.success("Transfer accepted");
      await navigate({ to: "/p/$projectId", params: { projectId: res.projectId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to accept");
    } finally {
      setPending(false);
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-8">Transfer link is invalid or has been removed.</div>;

  return (
    <div className="min-h-[100dvh] grid place-items-center bg-background p-6">
      <div className="max-w-md w-full rounded-xl border p-6 space-y-4">
        <h1 className="text-xl font-bold">Accept ownership of "{data.projectName}"</h1>
        <p className="text-sm text-muted-foreground">
          This transfer was sent to <b>{data.toEmail}</b>. Once accepted, the project moves into your workspace and you become the owner.
        </p>
        <div className="text-xs text-muted-foreground">Status: {data.status} · expires {new Date(data.expiresAt).toLocaleDateString()}</div>

        {data.status !== "pending" ? (
          <div className="text-sm text-muted-foreground">This transfer is {data.status}.</div>
        ) : !signedIn ? (
          <Button onClick={() => navigate({ to: "/auth", search: { next: `/transfers/${token}` } as never })} className="w-full">
            Sign in to accept <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        ) : signedIn.email?.toLowerCase() !== data.toEmail.toLowerCase() ? (
          <div className="text-sm text-destructive">
            You're signed in as {signedIn.email}. Sign in as {data.toEmail} to accept this transfer.
          </div>
        ) : (
          <Button onClick={onAccept} disabled={pending} className="w-full">
            {pending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Accept transfer
          </Button>
        )}

        <div className="text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">Cancel</Link>
        </div>
      </div>
    </div>
  );
}