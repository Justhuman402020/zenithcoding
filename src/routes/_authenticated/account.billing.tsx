import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getMyBilling, createCheckoutSession, createBillingPortalSession } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Sparkles, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/account/billing")({
  head: () => ({ meta: [{ title: "Billing — Forge" }] }),
  component: BillingPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">Billing error: {error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function BillingPage() {
  const fetchBilling = useServerFn(getMyBilling);
  const checkoutFn = useServerFn(createCheckoutSession);
  const portalFn = useServerFn(createBillingPortalSession);
  const [pending, setPending] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["billing"], queryFn: () => fetchBilling() });

  async function upgrade(slug: string) {
    setPending(slug);
    try {
      const res = await checkoutFn({ data: { planSlug: slug } });
      if (res.url) window.location.assign(res.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start checkout");
    } finally {
      setPending(null);
    }
  }

  async function manage() {
    setPending("portal");
    try {
      const res = await portalFn();
      if (res.url) window.location.assign(res.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open portal");
    } finally {
      setPending(null);
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading billing…</div>;

  const currentSlug = (data?.subscription as { plans?: { slug?: string } } | null)?.plans?.slug ?? "free";

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing & credits</h1>
          <p className="text-sm text-muted-foreground">Manage your subscription and see how your credits are being used.</p>
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
      </div>

      <div className="rounded-xl border p-6 bg-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Credit balance</div>
            <div className="text-4xl font-bold mt-1">{data?.balance ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">1 credit per AI message.</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Current plan</div>
            <div className="text-lg font-semibold capitalize">{currentSlug}</div>
            {data?.subscription?.status ? <div className="text-xs text-muted-foreground">Status: {data.subscription.status}</div> : null}
            {data?.subscription?.stripe_customer_id ? (
              <Button size="sm" variant="outline" className="mt-2" onClick={manage} disabled={pending === "portal"}>
                {pending === "portal" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ExternalLink className="h-3 w-3 mr-1" />}
                Manage billing
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Plans</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data?.plans ?? []).map((p) => (
            <div key={p.id} className="rounded-xl border p-4 flex flex-col">
              <div className="text-sm text-muted-foreground">{p.name}</div>
              <div className="text-2xl font-bold mt-1">${(p.price_cents / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
              <div className="text-xs text-muted-foreground mt-1">{p.monthly_credits} credits/mo</div>
              <Button
                className="mt-4"
                variant={currentSlug === p.slug ? "outline" : "default"}
                disabled={pending !== null || currentSlug === p.slug || p.price_cents === 0}
                onClick={() => upgrade(p.slug)}
              >
                {pending === p.slug ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                {currentSlug === p.slug ? "Current" : p.price_cents === 0 ? "Free" : "Upgrade"}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Recent activity</h2>
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Reason</th>
                <th className="p-2 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {(data?.ledger ?? []).map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2 text-muted-foreground">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="p-2 capitalize">{row.reason.replace(/_/g, " ")}</td>
                  <td className={`p-2 text-right font-medium ${row.delta < 0 ? "text-destructive" : "text-emerald-500"}`}>
                    {row.delta > 0 ? "+" : ""}{row.delta}
                  </td>
                </tr>
              ))}
              {(data?.ledger ?? []).length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">No activity yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-right">
          <Button size="sm" variant="ghost" onClick={() => refetch()}>Refresh</Button>
        </div>
      </div>
    </div>
  );
}