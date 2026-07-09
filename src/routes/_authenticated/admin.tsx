import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getAdminStatus, unlockAdmin, lockAdmin } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck, Lock, KeyRound, Loader2, Unlock, Users } from "lucide-react";
import { ForgeMark } from "@/components/ForgeMark";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Forge — Admin" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const fetchStatus = useServerFn(getAdminStatus);
  const doUnlock = useServerFn(unlockAdmin);
  const doLock = useServerFn(lockAdmin);

  const [status, setStatus] = useState<{ unlocked: boolean; unlockedAt: number | null } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setStatus(await fetchStatus({})); } catch { setStatus({ unlocked: false, unlockedAt: null }); }
  }
  useEffect(() => { refresh(); }, []);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    try {
      const { ok } = await doUnlock({ data: { key: key.trim() } });
      if (ok) {
        toast.success("Admin unlocked");
        setKey("");
        await refresh();
      } else {
        toast.error("Incorrect key");
      }
    } catch (err: any) {
      toast.error(err?.message || "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLock() {
    setBusy(true);
    try {
      await doLock({});
      toast.success("Admin locked");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl hairline-gold bg-card/70 p-6 shadow-candlelight space-y-4">
        <div className="flex items-center gap-3">
          <ForgeMark className="h-8 w-8" glow />
          <div>
            <h1 className="font-display text-xl">Forge Admin</h1>
            <p className="text-xs text-muted-foreground">Your personal control key</p>
          </div>
        </div>

        {status?.unlocked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              Admin unlocked
              {status.unlockedAt && (
                <span className="text-xs text-muted-foreground ml-auto">
                  since {new Date(status.unlockedAt).toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              You now have admin powers in this browser. Anything you build here is a personal admin project.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => navigate({ to: "/" })} className="flex-1 bg-gold-gradient text-primary-foreground">
                Go to dashboard
              </Button>
              <Button variant="outline" onClick={onLock} disabled={busy} className="gap-1.5">
                <Lock className="h-4 w-4" /> Lock
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/admin/users" })}
              className="w-full gap-1.5"
            >
              <Users className="h-4 w-4" /> Manage users
            </Button>
          </div>
        ) : (
          <form onSubmit={onUnlock} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter the personal admin key you saved. It stays unlocked in this browser for 30 days.
            </p>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Your admin key"
                autoComplete="current-password"
                className="pl-9"
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !key.trim()}
              className="w-full bg-gold-gradient text-primary-foreground shadow-gold-glow"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
              Unlock admin
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Forgot it? Reset the key from Backend → Secrets → <code>FORGE_ADMIN_KEY</code>.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}