import { useState } from "react";
import { ArrowLeft, Clock, FileCode2, FilePen, Lightbulb, ListChecks, Search, SquareTerminal, X } from "lucide-react";

type Step = { time: string; text: string };

export function parseWorkLog(log: string) {
  const [stepsPart, filesPart = ""] = log.split(/\n\nFiles changed:\n/);
  const steps: Step[] = stepsPart
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d\d:\d\d:\d\d) UTC · (.*)$/);
      return m ? { time: m[1], text: m[2] } : { time: "", text: l };
    });
  const files = filesPart
    .split("\n")
    .map((l) => l.replace(/^- `?|`$/g, "").trim())
    .filter(Boolean);
  return { steps, files };
}

function secs(t: string) {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

export function workedFor(steps: Step[]) {
  const times = steps.filter((s) => s.time).map((s) => secs(s.time));
  if (times.length < 2) return null;
  let d = times[times.length - 1] - times[0];
  if (d < 0) d += 86400;
  return d >= 60 ? `${Math.floor(d / 60)}m ${d % 60}s` : `${d}s`;
}

function iconFor(text: string) {
  const t = text.toLowerCase();
  if (/(edit|wrote|write|creat|updat|patch|delet|renam)/.test(t)) return FilePen;
  if (/(read|view|open)/.test(t)) return FileCode2;
  if (/(search|find|grep|list)/.test(t)) return Search;
  if (/(think|plan|reason)/.test(t)) return Lightbulb;
  return SquareTerminal;
}

export function WorkLogCard({ log, title }: { log: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"timeline" | "changes">("timeline");
  const { steps, files } = parseWorkLog(log);
  const dur = workedFor(steps);

  return (
    <>
      <div className="mt-3 rounded-2xl border border-border/70 bg-card/70 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-background/40 px-3 py-2.5">
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-base font-medium">{title || "Build"}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 px-1 text-sm text-muted-foreground">
          {dur && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Worked for {dur}</span>}
          <span>{steps.length} steps · {files.length} files</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 w-full rounded-full border border-border bg-background/40 py-2.5 text-base font-medium hover:bg-accent/40"
        >
          Details
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <button onClick={() => setOpen(false)} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full border border-border">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex rounded-full border border-border p-1">
              {(["timeline", "changes"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`rounded-full px-4 py-1.5 text-base capitalize ${tab === k ? "bg-accent text-foreground" : "text-muted-foreground"}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto p-2 text-muted-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex items-center gap-4 border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
            {dur && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" /> Worked for {dur}</span>}
            <span>{steps.length} steps</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {tab === "timeline" ? (
              steps.length ? (
                <ol className="relative space-y-5 pl-9 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-border">
                  {steps.map((s, i) => {
                    const Icon = iconFor(s.text);
                    return (
                      <li key={i} className="relative">
                        <span className="absolute -left-9 top-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                        <div className="break-words text-base">{s.text}</div>
                        {s.time && <div className="text-xs text-muted-foreground">{s.time} UTC</div>}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-muted-foreground">No steps were recorded.</p>
            ) : files.length ? (
              <ul className="space-y-3">
                {files.map((f) => (
                  <li key={f} className="flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-3">
                    <FilePen className="h-4 w-4 shrink-0 text-primary" />
                    <span className="text-base">Modified</span>
                    <code className="truncate rounded bg-muted px-2 py-0.5 text-sm">{f}</code>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">No files changed.</p>}
          </div>
        </div>
      )}
    </>
  );
}
