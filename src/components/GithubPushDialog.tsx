import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getProjectGithubLink,
  listProjectGithubBranches,
} from "@/lib/github.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Github, Loader2, GitBranch, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

type LinkInfo = {
  owner: string;
  repo: string;
  default_branch: string;
  last_pushed_branch: string | null;
  last_pushed_sha: string | null;
  last_pushed_message: string | null;
  last_pushed_at: string | null;
};

type LogLine = {
  level: "info" | "warn" | "error" | "success";
  message: string;
  ts: number;
};

export function GithubPushDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}) {
  const getLink = useServerFn(getProjectGithubLink);
  const listBranches = useServerFn(listProjectGithubBranches);

  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [branches, setBranches] = useState<{ name: string; sha: string }[]>([]);
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("");
  const [message, setMessage] = useState("Update from Forge");
  const [pushing, setPushing] = useState(false);
  const [lastResult, setLastResult] = useState<{ url: string; branch: string; sha: string } | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLastResult(null);
    setLogs([]);
    setProgress(null);
    setPushError(null);
    setLoading(true);
    (async () => {
      try {
        const l = (await getLink({ data: { projectId } })) as LinkInfo | null;
        setLink(l);
        if (l) {
          const res = await listBranches({ data: { projectId } });
          setBranches(res.branches);
          const initial = l.last_pushed_branch || l.default_branch || res.branches[0]?.name || "";
          setBranch(initial);
          setFromBranch(l.default_branch || initial);
        }
      } catch (e: any) {
        toast.error(e?.message || "Could not load GitHub info");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, projectId, getLink, listBranches]);

  async function handlePush() {
    const targetBranch = createBranch ? newBranch.trim() : branch.trim();
    if (!targetBranch) return toast.error("Pick or name a branch");
    if (!message.trim()) return toast.error("Write a commit message");
    setPushing(true);
    setLogs([]);
    setProgress(null);
    setPushError(null);
    setLastResult(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");

      const res = await fetch("/api/public/push-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          branch: targetBranch,
          message: message.trim(),
          createBranch,
          fromBranch: createBranch ? fromBranch.trim() || undefined : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: { url: string; branch: string; sha: string; fileCount: number } | null = null;
      let errorMsg: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "log") {
              setLogs((prev) => [
                ...prev,
                { level: evt.level, message: evt.message, ts: Date.now() },
              ]);
            } else if (evt.type === "progress") {
              setProgress({ phase: evt.phase, current: evt.current, total: evt.total });
            } else if (evt.type === "result") {
              result = evt;
            } else if (evt.type === "error") {
              errorMsg = evt.message;
            }
          } catch {
            // ignore malformed line
          }
        }
      }

      if (result) {
        setLastResult({ url: result.url, branch: result.branch, sha: result.sha });
        toast.success(`Pushed ${result.fileCount} files to ${result.branch}`);
      } else {
        const msg = errorMsg || "Push failed";
        setPushError(msg);
        toast.error(msg);
      }
    } catch (e: any) {
      const msg = e?.message || "Push failed";
      setPushError(msg);
      setLogs((prev) => [...prev, { level: "error", message: msg, ts: Date.now() }]);
      toast.error(msg);
    } finally {
      setPushing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5 text-primary" />
            <span className="font-display text-2xl">Push to GitHub</span>
          </DialogTitle>
          <DialogDescription>
            {link
              ? <>Commit your current files to <code className="px-1 rounded bg-muted/40">{link.owner}/{link.repo}</code>.</>
              : "This project isn't linked to a GitHub repository yet."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !link ? (
          <p className="py-4 text-sm text-muted-foreground">
            Import a repository from the home page to enable push. Forge keeps a link
            between each imported project and its GitHub repository.
          </p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Branch</Label>
              {!createBranch ? (
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name}{b.name === link.default_branch ? "  ·  default" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, "-"))}
                    placeholder="feature/my-update"
                  />
                  <div className="text-xs text-muted-foreground">
                    Branch from
                  </div>
                  <Select value={fromBranch} onValueChange={setFromBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder="Source branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <Switch checked={createBranch} onCheckedChange={setCreateBranch} />
                Create a new branch
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="commit-msg">Commit message</Label>
              <Textarea
                id="commit-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Describe what changed"
              />
            </div>

            {link.last_pushed_at && (
              <p className="text-xs text-muted-foreground">
                Last push: <span className="text-foreground">{link.last_pushed_branch}</span>
                {" · "}
                <span title={link.last_pushed_message || ""}>
                  {link.last_pushed_sha?.slice(0, 7)}
                </span>
                {" · "}
                {new Date(link.last_pushed_at).toLocaleString()}
              </p>
            )}

            {lastResult && (
              <a
                href={lastResult.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                View commit {lastResult.sha.slice(0, 7)} on {lastResult.branch}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {(pushing || logs.length > 0 || progress || pushError) && (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                {progress && progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="capitalize">{progress.phase}</span>
                      <span>
                        {progress.current}/{progress.total}
                      </span>
                    </div>
                    <Progress value={Math.round((progress.current / progress.total) * 100)} />
                  </div>
                )}
                <div className="max-h-44 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
                  {logs.length === 0 ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Starting push…
                    </div>
                  ) : (
                    logs.map((l, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex gap-2",
                          l.level === "error" && "text-destructive",
                          l.level === "warn" && "text-amber-500",
                          l.level === "success" && "text-emerald-500",
                          l.level === "info" && "text-muted-foreground",
                        )}
                      >
                        <span className="shrink-0 opacity-60">
                          {l.level === "error"
                            ? "✗"
                            : l.level === "success"
                              ? "✓"
                              : l.level === "warn"
                                ? "!"
                                : "›"}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{l.message}</span>
                      </div>
                    ))
                  )}
                </div>
                {pushError && (
                  <div className="text-xs text-destructive">{pushError}</div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pushing}>
            Close
          </Button>
          {link && (
            <Button
              type="button"
              onClick={handlePush}
              disabled={pushing}
              className="bg-gold-gradient text-primary-foreground hover:opacity-95 shadow-gold-glow"
            >
              {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Push"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}