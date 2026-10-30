import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

export function ScrolltidePreview({ title, preview, poster, source }: { title: string; preview: string | null; poster?: string | null; source: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const isVideo = Boolean(preview && /\.(mp4|webm)(?:\?|$)/i.test(preview));

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible) setActive(true);
      const media = video.current;
      if (!media) return;
      if (!visible) media.pause();
      else if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void media.play().catch(() => {});
    }, { root: element.closest('[role="dialog"]'), rootMargin: "120px" });
    observer.observe(element);
    return () => { observer.disconnect(); video.current?.pause(); };
  }, []);

  return <div ref={frame} className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
    {poster && !posterFailed && <img src={active ? poster : undefined} alt={`${title} preview`} className="absolute inset-0 h-full w-full object-contain" onLoad={() => setReady(true)} onError={() => setPosterFailed(true)} />}
    {preview && !failed && (isVideo ? <video ref={video} src={active ? preview : undefined} aria-label={`${title} preview`} className="h-full w-full object-contain" controls muted loop playsInline preload={active ? "auto" : "none"} onLoadedData={() => {
      setReady(true);
      const media = video.current;
      if (media && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) void media.play().catch(() => {});
    }} onError={() => setFailed(true)} /> : <img src={active ? preview : undefined} alt={title} className="h-full w-full object-contain" referrerPolicy="no-referrer" onLoad={() => setReady(true)} onError={() => setFailed(true)} />)}
    {preview && !failed && !ready && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">Loading {title} preview</span></div>}
    {(!preview || failed) && (!poster || posterFailed) && <a href={source} target="_blank" rel="noopener noreferrer" className="absolute inset-0 flex items-center justify-center gap-2 p-3 text-sm text-primary"><ExternalLink className="h-4 w-4 shrink-0" />Open {title} preview</a>}
  </div>;
}