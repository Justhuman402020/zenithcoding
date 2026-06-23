import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getProjectGithubLink,
  listProjectGithubBranches,
  pushProjectToGithub,
} from "@/lib/github.functions";
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

type LinkInfo = {
  owner: string;
  repo: string;
  default_branch: string;
  last_pushed_branch: string | null;
  last_pushed_sha: string | null;
  last_pushed_message: string | null;
  last_pushed_at: string | null;
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
  const pushFn = useServerFn(pushProjectToGithub);

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

  useEffect(() => {
    if (!open) return;
    setLastResult(null);
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
    try {
      const res = await pushFn({
        data: {
          projectId,
          branch: targetBranch,
          message: message.trim(),
          createBranch,
          fromBranch: createBranch ? fromBranch.trim() || undefined : undefined,
        },
      });
      setLastResult({ url: res.url, branch: res.branch, sha: res.sha });
      toast.success(`Pushed ${res.fileCount} files to ${res.branch}`);
    } catch (e: any) {
      toast.error(e?.message || "Push failed");
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