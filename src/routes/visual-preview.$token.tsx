import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { loadVisualPreview } from "@/lib/visual-preview.functions";
import { buildInBrowser } from "@/lib/browser-build";
import { projectPreviewDocument } from "@/lib/project-preview";
import { REPORTER_SCRIPT } from "@/lib/browser-check-policy";

export const Route = createFileRoute("/visual-preview/$token")({
  head: () => ({ meta: [{ title: "Private visual test — Code Haven" }, { name: "description", content: "Short-lived private Code Haven project visual test." }, { property: "og:title", content: "Private visual test — Code Haven" }, { property: "og:description", content: "Short-lived private Code Haven project visual test." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex,nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: VisualPreview,
});
function VisualPreview() {
  const { token } = Route.useParams();
  const load = useServerFn(loadVisualPreview);
  const [scrollTo, setScrollTo] = useState(0);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const report = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setScrollTo(Number(new URLSearchParams(window.location.search).get("__scroll")) || 0);
    let cancelled = false;
    void (async () => {
      try {
        const { files } = await load({ data: { token } });
        const result = await buildInBrowser(files);
        if (!result.ok) throw new Error(result.error);
        const bridge = `<script>${REPORTER_SCRIPT};setInterval(function(){var r=document.getElementById('__ch_report');if(r)parent.postMessage({type:'visual-report',text:r.textContent},'*');},500);<\/script>`;
        const doc = projectPreviewDocument(result.files).replace(/<head[^>]*>/i, (tag) => tag + bridge);
        if (!cancelled) setHtml(doc);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Preview build failed"); }
    })();
    return () => { cancelled = true; };
  }, [token, load]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "visual-report" || typeof event.data.text !== "string") return;
      if (report.current) report.current.textContent = event.data.text;
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  return <div className="h-[100dvh] w-full bg-background text-foreground">
    <pre id="__ch_report" ref={report} className="hidden">{JSON.stringify({ pageErrors: [error || "Preview has not finished rendering"], brokenImages: [], failedLoads: [] })}</pre>
    {html ? <iframe ref={frame} title="Private project visual preview" sandbox="allow-scripts allow-forms" className="block h-full w-full border-0" srcDoc={html + `<script>window.addEventListener('load',function(){setTimeout(function(){scrollTo(0,${scrollTo})},200)});<\/script>`} /> : <div role="status" className="p-6">{error || "Preparing preview…"}</div>}
  </div>;
}