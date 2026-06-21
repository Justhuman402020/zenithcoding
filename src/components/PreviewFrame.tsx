import { useEffect, useRef, useState } from "react";
import { Smartphone, Tablet, Monitor, RefreshCw, ExternalLink, Terminal, Trash2 } from "lucide-react";

type Device = "mobile" | "tablet" | "desktop";
type LogLevel = "log" | "info" | "warn" | "error";
type LogEntry = { id: number; level: LogLevel; text: string; ts: number };

const DEVICE_WIDTH: Record<Device, number | null> = {
  mobile: 390,
  tablet: 768,
  desktop: null,
};

const CONSOLE_BRIDGE = `<script>(()=>{
  const send=(level,args)=>{
    try{
      const text=args.map(a=>{
        if(a instanceof Error)return a.stack||a.message;
        if(typeof a==='object'){try{return JSON.stringify(a)}catch(_){return String(a)}}
        return String(a);
      }).join(' ');
      parent.postMessage({type:'forge-preview-log',level,text},'*');
    }catch(_){}
  };
  ['log','info','warn','error'].forEach(level=>{
    const orig=console[level];
    console[level]=function(){send(level,Array.from(arguments));return orig.apply(console,arguments);};
  });
  window.addEventListener('error',e=>send('error',[e.message+' ('+(e.filename||'')+':'+(e.lineno||0)+')']));
  window.addEventListener('unhandledrejection',e=>send('error',['Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)]));
})();<\/script>`;

export function injectConsoleBridge(html: string): string {
  if (html.includes("forge-preview-log")) return html;
  if (html.includes("</head>")) return html.replace(/<\/head>/i, `${CONSOLE_BRIDGE}</head>`);
  return `${CONSOLE_BRIDGE}${html}`;
}

export function PreviewFrame({
  srcDoc,
  previewKey,
  onRefresh,
  openInNewTab,
}: {
  srcDoc: string;
  previewKey: number;
  onRefresh: () => void;
  openInNewTab?: () => void;
}) {
  const [device, setDevice] = useState<Device>("mobile");
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | LogLevel>("all");
  const counterRef = useRef(0);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { type?: string; level?: LogLevel; text?: string } | undefined;
      if (d?.type !== "forge-preview-log" || !d.level || !d.text) return;
      counterRef.current += 1;
      setLogs((cur) => [
        ...cur.slice(-499),
        { id: counterRef.current, level: d.level!, text: d.text!, ts: Date.now() },
      ]);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Clear logs on refresh
  useEffect(() => {
    setLogs([]);
  }, [previewKey]);

  const width = DEVICE_WIDTH[device];
  const errorCount = logs.filter((l) => l.level === "error").length;
  const visible = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      {/* Device toolbar */}
      <div className="h-11 flex items-center gap-1 px-2 hairline-bottom-gold bg-card/40 shrink-0">
        <div className="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
          {([
            { k: "mobile", icon: Smartphone, label: "Mobile" },
            { k: "tablet", icon: Tablet, label: "Tablet" },
            { k: "desktop", icon: Monitor, label: "Desktop" },
          ] as const).map(({ k, icon: Icon, label }) => (
            <button
              key={k}
              onClick={() => setDevice(k)}
              title={label}
              className={`h-7 px-2 inline-flex items-center gap-1.5 text-xs rounded transition-colors ${
                device === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setConsoleOpen((o) => !o)}
            className={`h-7 px-2 inline-flex items-center gap-1.5 text-xs rounded transition-colors ${
              consoleOpen
                ? "bg-primary/15 text-primary"
                : errorCount > 0
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-muted-foreground hover:text-foreground"
            }`}
            title="Console"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Console</span>
            {logs.length > 0 && (
              <span className={`h-4 min-w-[16px] px-1 rounded-full text-[10px] inline-flex items-center justify-center ${errorCount > 0 ? "bg-destructive text-destructive-foreground" : "bg-primary/20 text-primary"}`}>
                {logs.length > 99 ? "99+" : logs.length}
              </span>
            )}
          </button>
          <button onClick={onRefresh} title="Rebuild preview" className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-accent/30">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {openInNewTab && (
            <button onClick={openInNewTab} title="Open published site" className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-accent/30">
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Iframe stage */}
      <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_center,_rgba(201,168,76,0.05)_0%,_transparent_70%)] grid place-items-start sm:place-items-center p-0 sm:p-4">
        <div
          className="bg-white rounded-none sm:rounded-lg overflow-hidden sm:shadow-candlelight sm:hairline-gold transition-all duration-300"
          style={width ? { width: `min(100%, ${width}px)`, height: "100%", maxHeight: "100%" } : { width: "100%", height: "100%" }}
        >
          <iframe
            key={previewKey}
            title="preview"
            sandbox="allow-scripts allow-forms allow-modals"
            className="w-full h-full bg-white block"
            srcDoc={srcDoc}
          />
        </div>
      </div>

      {/* Console drawer */}
      {consoleOpen && (
        <div className="hairline-top-gold bg-card/95 backdrop-blur-sm shrink-0 max-h-64 flex flex-col">
          <div className="h-8 flex items-center gap-1 px-2 border-b border-border/60 text-xs">
            <Terminal className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground mr-2">Console</span>
            {(["all", "log", "info", "warn", "error"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                  filter === f ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
            <button onClick={() => setLogs([])} className="ml-auto p-1 rounded text-muted-foreground hover:text-destructive" title="Clear">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {visible.length === 0 ? (
              <div className="p-3 text-muted-foreground/60 italic">No {filter === "all" ? "" : filter + " "}logs yet.</div>
            ) : (
              visible.map((l) => (
                <div
                  key={l.id}
                  className={`px-3 py-1 border-b border-border/30 whitespace-pre-wrap break-all ${
                    l.level === "error"
                      ? "text-destructive bg-destructive/5"
                      : l.level === "warn"
                        ? "text-amber-300"
                        : l.level === "info"
                          ? "text-primary/90"
                          : "text-foreground/80"
                  }`}
                >
                  <span className="opacity-50 mr-2">{l.level.toUpperCase()}</span>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}