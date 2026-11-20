import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, Loader2, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallContext = createContext<{
  installed: boolean;
  busy: boolean;
  install: () => Promise<boolean>;
}>({ installed: false, busy: false, install: async () => false });

export function AppInstallProvider({ children }: { children: ReactNode }) {
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
    };
    const onInstalled = () => { promptRef.current = null; setInstalled(true); };
    sync();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", sync);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", sync);
    };
  }, []);

  async function install() {
    const pending = promptRef.current;
    if (!pending) return false;
    promptRef.current = null;
    setBusy(true);
    try {
      await pending.prompt();
      // appinstalled, not acceptance alone, confirms installation completed.
      await pending.userChoice;
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <InstallContext.Provider value={{ installed, busy, install }}>{children}</InstallContext.Provider>;
}

export function AppInstallMenuItem() {
  const { installed, busy, install } = useContext(InstallContext);
  const [helpOpen, setHelpOpen] = useState(false);
  return <>
    <Button variant="ghost" className="w-full justify-start gap-2 px-3 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" disabled={busy || installed}
      onClick={async () => { if (!await install()) setHelpOpen(true); }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : installed ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      {installed ? "App installed" : busy ? "Installing…" : "Install Code Haven"}
    </Button>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md rounded-lg">
        <DialogHeader>
          <DialogTitle>Install Code Haven</DialogTitle>
          <DialogDescription>Open your published Code Haven website directly in Chrome or Edge, outside the preview.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-foreground">
          <div className="flex items-start gap-3"><Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" /><div><p className="font-medium">Android</p><p className="mt-1 text-muted-foreground">In Chrome, tap ⋮ → Add to Home screen → Install. Some browsers show “Install app” directly.</p></div></div>
          <div className="flex items-start gap-3"><Monitor className="h-5 w-5 shrink-0 text-muted-foreground" /><div><p className="font-medium">PC</p><p className="mt-1 text-muted-foreground">In Chrome, open ⋮ → Cast, save and share → Install page as app. In Edge, open ⋯ → Apps → Install this site as an app.</p></div></div>
        </div>
        <Button onClick={() => setHelpOpen(false)}>Got it</Button>
      </DialogContent>
    </Dialog>
  </>;
}