import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, ExternalLink, GitBranch, KeyRound, Loader2, Rocket, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { scanEnvKeys } from "@/lib/env-scanner";
import { getPreviewEnv, upsertProjectSecret } from "@/lib/project-secrets.functions";
import { listProjectGithubBranches, pushProjectToGithub } from "@/lib/github.functions";

export function SetupMatrix({
  projectId,
  files,
  onSaved,
}: {
  projectId: string;
  files: { path: string; content: string }[];
  onSaved?: () => void;
}) {
  const detected = useMemo(() => scanEnvKeys(files), [files]);
  const getEnv = useServerFn(getPreviewEnv);
  const upsert = useServerFn(upsertProjectSecret);
  const listBranches = useServerFn(listProjectGithubBranches);
  const push = useServerFn(pushProjectToGithub);
  const qc = useQueryClient();

  const envQ = useQuery({ queryKey: ["preview-env", projectId], queryFn: () => getEnv({ data: { projectId } }) });
  const branchQ = useQuery({
    queryKey: ["gh-branches", projectId],
    queryFn: () => listBranches({ data: { projectId } }),
    retry: false,
  });

  const saved = new Set(envQ.data?.saved ?? []);
  const missing = detected.filter((d) => !saved.has(d.key));
  const [open, setOpen] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [branchMode, setBranchMode] = useState<"existing" | "new">("new");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("setup-keys");
  const [publishing, setPublishing] = useState(false);

  if (detected.length === 0) return null;

  async function saveAll() {
    const entries = Object.entries(values).filter(([, v]) => v.trim());
    if (!entries.length) return toast.error("Paste at least one key first");
    setSaving(true);
    try {
      for (const [key, value] of entries) {
        const d = detected.find((x) => x.key === key);
        await upsert({ data: { projectId, key, value, expose_to_client: !!d?.clientSide, description: d ? `${d.service}: ${d.powers}` : undefined } });
      }
      setValues({});
      await qc.invalidateQueries({ queryKey: ["preview-env", projectId] });
      qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
      toast.success(`Saved ${entries.length} key(s) — preview is rebuilding`);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || "Could not save keys");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const def = branchQ.data?.default_branch || "main";
    const target = branchMode === "new" ? newBranch.trim() : branch || def;
    if (!target) return toast.error("Name a branch");
    setPublishing(true);
    try {
      await push({
        data: {
          projectId,
          branch: target,
          message: `Update project setup (${detected.length} env keys detected)`,
          createBranch: branchMode === "new",
          fromBranch: def,
        },
      });
      toast.success(`Pushed to ${target} on GitHub`);
      qc.invalidateQueries({ queryKey: ["gh-branches", projectId] });
    } catch (e: any) {
      toast.error(e?.message || "Push failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="border-b border-border bg-card/60 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <KeyRound className="h-4 w-4 text-primary" />
        <span className="font-medium">Setup table</span>
        <Badge variant={missing.length ? "destructive" : "secondary"}>
          {missing.length ? `${missing.length} of ${detected.length} keys missing` : `All ${detected.length} keys added`}
        </Badge>
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && (
        <div className="max-h-[45vh] overflow-auto px-3 pb-3">
          <p className="mb-2 text-xs text-muted-foreground">
            We scanned the code and found these settings. Missing ones use safe placeholders so the preview never goes blank. Paste real keys to make features work.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Key</th>
                  <th className="p-2">What it powers</th>
                  <th className="p-2">Where to get it</th>
                  <th className="p-2 w-56">Paste value</th>
                </tr>
              </thead>
              <tbody>
                {detected.map((d) => (
                  <tr key={d.key} className="border-t border-border align-top">
                    <td className="p-2">
                      <div className="font-mono font-medium break-all">{d.key}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{d.service}</Badge>
                        {d.clientSide ? <Badge variant="outline">public</Badge> : <Badge variant="outline">private</Badge>}
                      </div>
                    </td>
                    <td className="p-2">
                      {d.powers}
                      <div className="mt-1 text-[10px] text-muted-foreground break-all">Used in {d.foundIn.join(", ")}</div>
                    </td>
                    <td className="p-2">
                      {d.howTo}
                      {d.link && (
                        <a href={d.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary underline">
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    <td className="p-2">
                      {saved.has(d.key) && !values[d.key] ? (
                        <button type="button" className="inline-flex items-center gap-1 text-primary" onClick={() => setValues((v) => ({ ...v, [d.key]: " " }))}>
                          <Check className="h-3 w-3" /> Saved · replace
                        </button>
                      ) : (
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={d.exampleValue || "Paste here"}
                          value={values[d.key]?.trimStart() ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
                          className="h-8 text-xs"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={saveAll} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1 h-3 w-3" />}
              Save keys
            </Button>

            {branchQ.data ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  className="h-7 rounded bg-background text-xs"
                  value={branchMode}
                  onChange={(e) => setBranchMode(e.target.value as any)}
                >
                  <option value="new">New branch</option>
                  <option value="existing">Existing branch</option>
                </select>
                {branchMode === "new" ? (
                  <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className="h-7 w-36 text-xs" />
                ) : (
                  <select className="h-7 max-w-40 rounded bg-background text-xs" value={branch || branchQ.data.default_branch} onChange={(e) => setBranch(e.target.value)}>
                    {branchQ.data.branches.map((b) => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                )}
                <Button size="sm" variant="secondary" onClick={publish} disabled={publishing}>
                  {publishing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Rocket className="mr-1 h-3 w-3" />}
                  Publish to GitHub
                </Button>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Link this project to GitHub to publish to a branch.</span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Keys are stored encrypted and are never written into GitHub.</p>
        </div>
      )}
    </div>
  );
}
