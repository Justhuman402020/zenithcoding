import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { listProjectAi } from "@/lib/project-ai.functions";
import { ProjectCloudflareSwitch } from "@/components/ProjectCloudflareSwitch";
import { BuildApprovalHost } from "@/components/BuildApprovalDialog";

export const Route = createFileRoute("/_authenticated/admin/cloudflare-projects")({
  head: () => ({ meta: [{ title: "Projects with Cloudflare — Code Haven" }, { name: "description", content: "Choose which projects run their AI chat on your Cloudflare credit." }, { property: "og:title", content: "Projects with Cloudflare — Code Haven" }, { property: "og:description", content: "Choose which projects run their AI chat on your Cloudflare credit." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Page,
});

function Page() {
  const list = useServerFn(listProjectAi);
  const q = useQuery({ queryKey: ["project-ai"], queryFn: () => list() });
  return (
    <div className="min-h-[100dvh] bg-background px-4 py-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Admin</Link>
        <div>
          <h1 className="font-display text-xl">Projects with Cloudflare</h1>
          <p className="text-sm text-muted-foreground">Tap a switch to run that project's AI chat on your Cloudflare credit. You'll approve the change before the agent rewires the chat.</p>
        </div>
        {q.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : null}
        {q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : null}
        <div className="space-y-2">
          {(q.data ?? []).map((row) => <ProjectCloudflareSwitch key={row.id} row={row} onChange={() => q.refetch()} />)}
        </div>
      </div>
      <BuildApprovalHost />
    </div>
  );
}
