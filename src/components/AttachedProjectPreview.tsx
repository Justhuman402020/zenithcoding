import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2, X, ScanEye } from "lucide-react";
import { toast } from "sonner";
import { startVisualCheck } from "@/lib/visual-check.functions";
import { BuildApprovalHost, requestApproval } from "./BuildApprovalDialog";
import { Button } from "@/components/ui/button";
import { PreviewFrame, injectConsoleBridge } from "./PreviewFrame";
import { listProjectFiles } from "@/lib/assistant.functions";
import { getPreviewEnv } from "@/lib/project-secrets.functions";
import { buildInBrowser, isBuildable, type BuildFile } from "@/lib/browser-build";
import { previewPath, previewSourceFiles, projectPreviewDocument } from "@/lib/project-preview";

export function AttachedProjectPreview({ projectId, name, onClose }: { projectId: string; name: string; onClose: () => void }) {
  const load = useServerFn(listProjectFiles);
  const loadEnv = useServerFn(getPreviewEnv);
  const startCheck = useServerFn(startVisualCheck);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<BuildFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [path, setPath] = useState("index.html");
  const signature = useRef("");
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await load({ data: { projectId } });
        if (cancelled) return;
        const source = previewSourceFiles(rows.map((file) => ({ path: file.path, content: file.text })));
        const next = JSON.stringify(source);
        if (signature.current === next) return;
        setLoading(true);
        let output = source;
        if (isBuildable(source).buildable) {
          const { env } = await loadEnv({ data: { projectId } });
          if (cancelled) return;
          const result = await buildInBrowser(source, undefined, { env });
          if (!result.ok) throw new Error(result.error);
          output = result.files;
        }
        if (cancelled) return;
        signature.current = next;
        setFiles(output); setError("");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load preview. Try refresh.");
      } finally { inFlight = false; if (!cancelled) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, revision, load, loadEnv]);
  useEffect(() => {
    function navigate(event: MessageEvent) {
      if (event.source !== document.querySelector<HTMLIFrameElement>('[data-attached-preview] iframe')?.contentWindow) return;
      const message = event.data;
      if (message?.type !== "forge-preview-navigate" || typeof message.path !== "string") return;
      const target = previewPath(message.path, path);
      if (files.some((file) => previewPath(file.path) === target)) setPath(target);
    }
    window.addEventListener("message", navigate);
    return () => window.removeEventListener("message", navigate);
  }, [files, path]);
  const html = useMemo(() => injectConsoleBridge(projectPreviewDocument(files, path)), [files, path]);
  return <section data-attached-preview aria-label={`${name} preview`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <BuildApprovalHost />
    <div className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3">
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4 shrink-0" /><span className="truncate">{name}</span></span>
      <div className="flex items-center"><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Inspect preview screenshots" title="Inspect screenshots · uses browser and image-reader credit" disabled={checking || loading} onClick={async () => { if (!(await requestApproval("openrouter-image", "Inspect phone and PC screenshots with your selected image reader? Browser and model credit may be used. No files will be edited."))) return; setChecking(true); try { await startCheck({ data: { projectId, html } }); toast.success("Screenshot inspection started; results will be saved in the project work log."); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not start check"); } finally { setChecking(false); } }}><ScanEye className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close preview" onClick={onClose}><X className="h-4 w-4" /></Button></div>
    </div>
    {loading && <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Preparing preview…</div>}
    {error && <div role="alert" className="max-h-24 overflow-auto p-3 text-sm text-destructive">{error}</div>}
    <PreviewFrame srcDoc={html} previewKey={revision} onRefresh={() => { signature.current = ""; setRevision((value) => value + 1); }} />
  </section>;
}