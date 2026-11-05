import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { requestApproval } from "@/components/BuildApprovalDialog";
import { listProjectAiModels, setProjectAiModel, setProjectCloudflare, testProjectCloudflare } from "@/lib/project-ai.functions";

const LABEL: Record<string, string> = { off: "Off", setting_up: "Setting up", on: "On", needs_fix: "Needs fix" };
const TONE: Record<string, string> = { off: "text-muted-foreground", setting_up: "text-primary", on: "text-emerald-500", needs_fix: "text-destructive" };

export type ProjectAiRow = { id: string; name: string; cloudflare_enabled: boolean; status: string; last_error: string | null; last_reply: string | null; model: string | null };

export function ProjectCloudflareSwitch({ row, onChange }: { row: ProjectAiRow; onChange: () => void }) {
  const navigate = useNavigate();
  const setFn = useServerFn(setProjectCloudflare);
  const testFn = useServerFn(testProjectCloudflare);
  const modelsFn = useServerFn(listProjectAiModels);
  const saveModel = useServerFn(setProjectAiModel);
  const modelsQ = useQuery({ queryKey: ["project-ai-models"], queryFn: () => modelsFn(), enabled: row.cloudflare_enabled, staleTime: 5 * 60_000 });
  const [busy, setBusy] = useState<"" | "switch" | "test" | "model">("");

  const toggle = async (on: boolean) => {
    setBusy("switch");
    try {
      const r = await setFn({ data: { projectId: row.id, enabled: on, origin: window.location.origin } });
      if (!r.ok) { toast.error(r.error); return; }
      onChange();
      if (on && r.prompt) {
        const ok = await requestApproval("cloudflare", "Switch this project's AI chat to Cloudflare");
        if (ok) navigate({ to: "/p/$projectId", params: { projectId: row.id }, search: { prompt: r.prompt } });
        else toast("Cloudflare is ready for this project. Approve the switch any time by tapping it off and on.");
      } else if (!on) toast("Cloudflare stopped for this project.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the switch");
    } finally { setBusy(""); }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await testFn({ data: { projectId: row.id } });
      r.ok ? toast.success(`Cloudflare replied: ${r.reply}`) : toast.error(r.error);
      onChange();
    } finally { setBusy(""); }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center gap-3">
        <Cloud className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.name}</div>
          <div className={`text-xs ${TONE[row.status] ?? ""}`}>{LABEL[row.status] ?? row.status}</div>
        </div>
        {busy === "switch" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <Switch aria-label={`Use Cloudflare for ${row.name}`} checked={row.cloudflare_enabled} disabled={!!busy} onCheckedChange={toggle} />
      </div>
      {row.cloudflare_enabled ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={test} className="h-8">
            {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Send test message
          </Button>
          <span className="truncate text-xs text-muted-foreground">{row.status === "needs_fix" ? row.last_error : row.last_reply}</span>
        </div>
      ) : null}
    </div>
  );
}
