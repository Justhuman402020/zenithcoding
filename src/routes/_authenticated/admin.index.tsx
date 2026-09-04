import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getMyRole } from "@/lib/admin-users.functions";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Lock, Loader2, Users, ArrowLeft, Cpu } from "lucide-react";
import { ForgeMark } from "@/components/ForgeMark";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Forge — Admin" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const fetchRole = useServerFn(getMyRole);

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetchRole({})
      .then(({ isAdmin }) => setIsAdmin(isAdmin))
      .catch(() => setIsAdmin(false))
      .finally(() => setChecking(false));
  }, []);

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

        {checking ? (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isAdmin ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              Samsung admin access active
            </div>
            <p className="text-sm text-muted-foreground">
              This Samsung account can remove users and see every project users have built.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => navigate({ to: "/" })} className="flex-1 bg-gold-gradient text-primary-foreground">
                Go to dashboard
              </Button>
            </div>
            <Button
              variant="default"
              onClick={() => navigate({ to: "/admin/users" })}
              className="w-full gap-1.5 bg-gold-gradient text-primary-foreground shadow-gold-glow"
            >
              <Users className="h-4 w-4" /> Manage users
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: "/admin/models" })} className="w-full gap-1.5">
              <Cpu className="h-4 w-4" /> AI model board
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: "/admin/domains" })} className="w-full gap-1.5">
              <Globe className="h-4 w-4" /> Domains & live links
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h2 className="font-display text-xl">Samsung admin only</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with <span className="text-foreground">justsamsung99@gmail.com</span> to manage Forge users.
            </p>
            <Button variant="outline" onClick={() => navigate({ to: "/" })} className="w-full gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}