import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyBilling } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { Coins } from "lucide-react";

export const Route = createFileRoute("/_authenticated/account/billing")({
  head: () => ({ meta: [{ title: "Billing — Forge" }] }),
  component: BillingPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">Billing error: {error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function BillingPage() {
  const fetchBilling = useServerFn(getMyBilling);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["billing"], queryFn: () => fetchBilling() });

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading billing…</div>;

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
            <Coins className="h-8 w-8 text-primary ml-auto" />
            <div className="text-sm text-muted-foreground mt-2">Funds are managed by Samsung admin.</div>
          </div>
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