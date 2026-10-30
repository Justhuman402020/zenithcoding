import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectScrolltide, removeScrolltide, scrolltideStatus } from "@/lib/scrolltide.functions";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";

export function ScrolltideConnection() {
  const status = useServerFn(scrolltideStatus); const connect = useServerFn(connectScrolltide); const disconnect = useServerFn(removeScrolltide);
  const { data, error, refetch } = useQuery({ queryKey: ["scrolltide-status"], queryFn: () => status(), refetchInterval: 5000 });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [confirm, setConfirm] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  async function start() {
    let popup: Window | null = null;
    setBusy(true); setMessage("Opening Scrolltide sign-in…"); setAuthUrl(null);
    try {
      try { popup = window.open("about:blank", "scrolltide-approval", "width=600,height=720"); } catch { /* The sign-in link below also works when popups are blocked. */ }
      const result = await connect({ data: { origin: window.location.origin } });
      if (result.authUrl) {
        setAuthUrl(result.authUrl);
        if (popup && !popup.closed) {
          try { popup.location.href = result.authUrl; setMessage("Sign in and approve in the Scrolltide window."); }
          catch { popup.close(); setMessage("Tap Open Scrolltide sign-in to continue."); }
        } else { setMessage("Tap Open Scrolltide sign-in to continue."); }
      }
      else { popup?.close(); setMessage("Connected to Scrolltide."); }
      await refetch();
    } catch (e) { popup?.close(); setMessage(e instanceof Error ? e.message : "Could not connect."); }
    finally { setBusy(false); }
  }
  return <section className="border-t border-border pt-5 space-y-3">
    <h2 className="text-xl font-semibold flex items-center gap-2"><Link2 className="h-5 w-5" />Scrolltide</h2>
    <p className="text-sm text-muted-foreground">{data?.state === "ready" ? "Connected" : data?.state === "authenticating" ? "Awaiting Scrolltide approval" : "Not connected"}</p>
    <div className="flex gap-2 flex-wrap"><Button onClick={() => void start()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{data?.state === "ready" ? "Reconnect Scrolltide" : "Connect Scrolltide"}</Button><Button variant="outline" size="icon" aria-label="Refresh connection" title="Refresh connection" onClick={() => void refetch()}><RefreshCw className="h-4 w-4" /></Button>{data?.state === "ready" && <Button variant="outline" onClick={() => setConfirm(true)}><Unplug className="h-4 w-4" />Disconnect</Button>}</div>
    {(message || error) && <p role="status" className="text-sm">{message || "Could not check your Scrolltide connection. Retry."}</p>}
    {authUrl && data?.state !== "ready" && <Button asChild variant="outline"><a href={authUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Open Scrolltide sign-in</a></Button>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogTitle>Disconnect Scrolltide?</AlertDialogTitle><AlertDialogDescription>Your Scrolltide subscription and other saved keys stay unchanged.</AlertDialogDescription><div className="flex gap-2"><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={busy} onClick={async () => { setBusy(true); try { await disconnect(); setConfirm(false); await refetch(); } catch { setMessage("Could not disconnect. Try again."); } finally { setBusy(false); } }}>Disconnect</Button></div></AlertDialogContent></AlertDialog>
  </section>;
}