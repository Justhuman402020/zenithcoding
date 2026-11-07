import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listProjectAi } from "@/lib/project-ai.functions";
import { ProjectCloudflareSwitch } from "@/components/ProjectCloudflareSwitch";
import { BuildApprovalHost } from "@/components/BuildApprovalDialog";

/** Project settings card: "Use Cloudflare for this project" for the site's AI chat. */
export function ProjectCloudflareCard({ projectId }: { projectId: string }) {
  const list = useServerFn(listProjectAi);
  const q = useQuery({ queryKey: ["project-ai"], queryFn: () => list() });
  const row = q.data?.find((r) => r.id === projectId);
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Use Cloudflare for this project</h2>
      <p className="text-sm text-muted-foreground">Runs this site's AI chat on your Cloudflare credit.</p>
      {row ? <ProjectCloudflareSwitch row={row} onChange={() => q.refetch()} /> : null}
      <BuildApprovalHost />
    </div>
  );
}
