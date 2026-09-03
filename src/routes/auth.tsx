import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ForgeMark } from "@/components/ForgeMark";

export const Route = createFileRoute("/auth")({
  // Keep the auth shell identical during SSR and hydration. Browser-only auth
  // checks run after mount, while submit handlers access window only on events.
  head: () => ({ meta: [{ title: "Sign in — Forge" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created — you're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[1.05fr_1fr] bg-background relative overflow-hidden">
      {/* Vignette glow */}
      <div className="pointer-events-none absolute inset-0 vignette" />

      {/* Left — editorial column (hidden on mobile) */}
      <aside className="hidden md:flex relative flex-col justify-between p-10 lg:p-14 border-r border-border/60">
        <div className="flex items-center gap-3">
          <ForgeMark className="h-10 w-10" glow />
          <span className="font-display text-2xl text-gold">Forge</span>
        </div>
        <div className="space-y-6 max-w-md">
          <h1 className="font-display text-5xl lg:text-6xl leading-[1.02]">
            A private <em className="text-gold not-italic">atelier</em> for building&nbsp;web.
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Forge is a quiet, premium AI coding workspace. Chat to build, watch it ship, publish to your own domain — all in pure gold and noir.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Build sites by conversation</li>
            <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Publish to a vanity URL or custom domain</li>
            <li className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-primary" /> Import any GitHub repo and keep editing</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground/70 font-mono uppercase tracking-[0.2em]">
          MMXXVI · Built for one · You
        </p>
      </aside>

      {/* Right — auth card */}
      <main className="relative flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          {/* Mobile brand header */}
          <div className="md:hidden flex items-center gap-3 justify-center mb-10">
            <ForgeMark className="h-9 w-9" glow />
            <span className="font-display text-2xl text-gold">Forge</span>
          </div>

          <div className="rounded-2xl border hairline-gold bg-card/70 backdrop-blur-sm p-7 shadow-candlelight">
            <div className="mb-6 space-y-1">
              <h2 className="font-display text-3xl leading-tight">
                {mode === "signin" ? "Welcome back." : "Begin forging."}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Step into your atelier."
                  : "Create your private workspace — takes a moment."}
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 bg-background/40" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 bg-background/40" />
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-gold-gradient text-primary-foreground font-medium hover:opacity-95 shadow-gold-glow"
                disabled={loading}
              >
                {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "New to Forge?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="text-primary hover:text-primary-glow underline-offset-4 hover:underline"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </div>
          </div>
          <p className="mt-6 text-center text-[11px] text-muted-foreground/60 font-mono uppercase tracking-[0.18em]">
            Pure gold · Built for one
          </p>
        </div>
      </main>
    </div>
  );
}
