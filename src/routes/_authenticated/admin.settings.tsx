import { createFileRoute, Link } from "@tanstack/react-router";
import { WorkspaceSecurity } from "@/components/WorkspaceSecurity";
export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Security settings — Code Haven" }, { name: "description", content: "Manage your private Code Haven password and signed-in devices." }, { property: "og:title", content: "Security settings — Code Haven" }, { property: "og:description", content: "Owner password and device security controls." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <main className="mx-auto max-w-3xl p-6 space-y-6"><Link to="/admin" className="text-sm text-muted-foreground">Back to Admin</Link><h1 className="text-2xl font-semibold">Settings</h1><WorkspaceSecurity /></main>,
});