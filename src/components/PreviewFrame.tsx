import { useEffect, useRef, useState } from "react";
import { Smartphone, Tablet, Monitor, RefreshCw, ExternalLink, Terminal, Trash2 } from "lucide-react";

type Device = "mobile" | "tablet" | "desktop";
type LogLevel = "log" | "info" | "warn" | "error";
type LogEntry = { id: number; level: LogLevel; text: string; ts: number; count: number };

const DEVICE_WIDTH: Record<Device, number | null> = {
  mobile: 390,
  tablet: 768,
  desktop: null,
};

const CONSOLE_BRIDGE = `<script>(()=>{
  const seen={};const rseen={};
  const send=(level,args)=>{
    try{
      const text=args.map(a=>{
        if(a instanceof Error)return a.stack||a.message;
        if(typeof a==='object'){try{return JSON.stringify(a)}catch(_){return String(a)}}
        return String(a);
      }).join(' ');
      if(level==='error'){const k=text.slice(0,300);const now=Date.now();const c=seen[k]||(seen[k]={n:0,t:0});c.n++;if(now-c.t<3000||c.n>20)return;c.t=now;}
      parent.postMessage({type:'forge-preview-log',level,text},'*');
    }catch(_){}
  };
  ['log','info','warn','error'].forEach(level=>{
    const orig=console[level];
    console[level]=function(){send(level,Array.from(arguments));return orig.apply(console,arguments);};
  });
  const snap=()=>{try{const b=document.body;return{title:document.title,path:location.pathname+location.hash,text:(b&&b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,1500),elements:b?b.getElementsByTagName('*').length:0,empty:!b||!(b.innerText||'').trim()}}catch(_){return null}};
  const report=(o)=>{const k=String(o.message||'').slice(0,300);const c=rseen[k]||(rseen[k]={n:0,t:0});c.n++;const now=Date.now();if(now-c.t<3000||c.n>20)return;c.t=now;o.count=c.n;try{setTimeout(()=>parent.postMessage(Object.assign({type:'forge-preview-error'},o,{snapshot:snap()}),'*'),50)}catch(_){}};
  window.addEventListener('error',e=>{
    if(!e.message&&e.target&&e.target!==window){const u=e.target.src||e.target.href||e.target.tagName;send('error',['Failed to load resource: '+u]);report({kind:'resource',message:'Failed to load resource: '+u});return;}
    send('error',[e.message+' ('+(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0)+')'+(e.error&&e.error.stack?'\\n'+e.error.stack:'')]);
    report({kind:'exception',message:String(e.message),stack:e.error&&e.error.stack||'',file:e.filename||'',line:e.lineno||0,col:e.colno||0});
  },true);
  window.addEventListener('unhandledrejection',e=>{const r=e.reason;send('error',['Unhandled rejection: '+(r&&r.message||r)+(r&&r.stack?'\\n'+r.stack:'')]);report({kind:'rejection',message:'Unhandled rejection: '+(r&&r.message||r),stack:r&&r.stack||''});});
  const oe=console.error;console.error=function(){try{const a=Array.from(arguments);const er=a.find(x=>x instanceof Error);report({kind:'console',message:a.map(x=>x instanceof Error?x.message:typeof x==='object'?(()=>{try{return JSON.stringify(x)}catch(_){return String(x)}})():String(x)).join(' ').slice(0,1000),stack:er&&er.stack||''})}catch(_){}return oe.apply(console,arguments)};
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
      setLogs((cur) => {
        // Bundle repeats of the same message into one line with a counter.
        const idx = cur.findIndex((l) => l.level === d.level && l.text === d.text);
        if (idx !== -1) {
          const next = cur.slice();
          next[idx] = { ...next[idx]!, count: next[idx]!.count + 1, ts: Date.now() };
          return next;
        }
        return [...cur.slice(-199), { id: counterRef.current, level: d.level!, text: d.text!, ts: Date.now(), count: 1 }];
      });
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
                  {l.count > 1 ? (
                    <span className="ml-2 rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold">×{l.count}</span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}