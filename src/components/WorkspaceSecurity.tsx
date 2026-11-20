import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
export function WorkspaceSecurity() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const cache = useQueryClient();
  async function signOut(all: boolean) {
    setBusy(true);
    try {
      if (all) { await cache.cancelQueries(); cache.clear(); }
      const { error } = await supabase.auth.signOut({ scope: all ? "global" : "others" });
      if (error) throw error;
      if (all) await navigate({ to: "/auth", replace: true }); else toast.success("Other devices signed out");
    } catch { toast.error("Could not sign out devices"); } finally { setBusy(false); }
  }
  return <section className="space-y-6">
    <h2 className="text-xl font-semibold">Security</h2>
    <form className="max-w-sm space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (password !== confirm) { toast.error("Passwords do not match"); return; }
      setBusy(true);
      try {
        const { error } = await supabase.auth.updateUser({ password, current_password: current });
        if (error) throw error;
        setCurrent(""); setPassword(""); setConfirm(""); toast.success("Password changed");
      } catch { toast.error("Password change failed. Check your current password and try again."); } finally { setBusy(false); }
    }}>
      <Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button disabled={busy} type="submit">Change password</Button>
    </form>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => signOut(false)}>Sign out other devices</Button><Button variant="destructive" disabled={busy} onClick={() => signOut(true)}>Sign out all devices, including this one</Button></div>
    <p className="text-xs text-muted-foreground">Other devices lose access immediately in Code Haven. Their sign-in tokens expire automatically.</p>
  </section>;
}