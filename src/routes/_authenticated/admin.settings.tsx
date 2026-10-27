import { createFileRoute, Link } from "@tanstack/react-router";
import { WorkspaceSecurity } from "@/components/WorkspaceSecurity";
import { RecentModels } from "@/components/RecentModels";
export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Settings & privacy — Code Haven" }, { name: "description", content: "Manage your Code Haven password, devices, and see which models replied recently." }, { property: "og:title", content: "Settings & privacy — Code Haven" }, { property: "og:description", content: "Owner security controls and recent model activity." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <main className="mx-auto max-w-3xl p-6 space-y-6"><Link to="/admin" className="text-sm text-muted-foreground">Back to Admin</Link><h1 className="text-2xl font-semibold">Settings & privacy</h1><WorkspaceSecurity /><RecentModels /></main>,
});
