import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, Clock, FilePen, ListChecks, Loader2, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getWorkDetails } from "@/lib/work-log.functions";
import { durationLabel, workedFor } from "@/lib/work-log";

function workQuery(projectId: string, runId: string, chatId?: string) {
  return queryOptions({ queryKey: ["work-details", projectId, runId, chatId], queryFn: () => getWorkDetails({ data: { projectId, runId, chatId } }), refetchInterval: query => ["queued", "running"].includes(query.state.data?.status ?? "") ? 2000 : false });
}
export const Route = createFileRoute("/_authenticated/work/$projectId/$runId")({
  validateSearch: (s: Record<string, unknown>) => ({ chatId: typeof s.chatId === "string" ? s.chatId : undefined }),
  loaderDeps: ({ search }) => ({ chatId: search.chatId }),
  loader: ({ context, params, deps }) => context.queryClient.ensureQueryData(workQuery(params.projectId, params.runId, deps.chatId)),
  head: () => ({ meta: [{ title: "Work timeline & changes — Code Haven" }, { name: "description", content: "Review saved Code Haven work steps and file changes." }, { property: "og:title", content: "Work timeline & changes — Code Haven" }, { property: "og:description", content: "Review saved Code Haven work steps and file changes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: WorkDetails,
  errorComponent: ({ error }) => <div className="p-5 text-foreground"><h1 className="text-lg font-semibold">Work log unavailable</h1><p className="mt-2 text-muted-foreground">{error.message}</p><Button asChild variant="outline" className="mt-4"><Link to="/">Home</Link></Button></div>,
});
function WorkDetails() {
  const { projectId, runId } = Route.useParams();
  const { chatId } = Route.useSearch();
  const { data } = useSuspenseQuery(workQuery(projectId, runId, chatId));
  const [tab, setTab] = useState<"timeline" | "changes">("timeline");
  const running = ["running", "queued"].includes(data.status);
  const elapsed = data.startedAt ? durationLabel((data.completedAt ? Date.parse(data.completedAt) : Date.now()) - Date.parse(data.startedAt)) : workedFor(data.steps);
  return <div className="flex h-[100dvh] flex-col bg-background text-foreground">
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-3">
      <Button asChild size="icon" variant="outline" title="Back to chat"><Link to={chatId ? "/chats/$chatId" : "/p/$projectId"} params={chatId ? { chatId } : { projectId }} resetScroll={false} aria-label="Back to chat"><ArrowLeft /></Link></Button>
      <div className="flex min-w-0 gap-1 rounded-lg border border-border p-1" role="tablist" aria-label="Work details">
        <Button role="tab" aria-selected={tab === "timeline"} variant={tab === "timeline" ? "secondary" : "ghost"} onClick={() => setTab("timeline")}><ListChecks />Timeline</Button>
        <Button role="tab" aria-selected={tab === "changes"} variant={tab === "changes" ? "secondary" : "ghost"} onClick={() => setTab("changes")}><FilePen />Changes</Button>
      </div>
    </header>
    <div className="shrink-0 border-b border-border px-4 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{elapsed && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{running ? "Working for" : "Worked for"} {elapsed}</span>}<span>{data.steps.length} recorded actions · {data.fileCount} files</span></div>
      <h1 className="mt-2 line-clamp-2 break-words text-base font-medium text-foreground">{data.title}</h1>
      {running && <p className="mt-2 flex items-start gap-2"><Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /><span className="break-words">{data.progress || "Waiting for the next recorded action…"}</span></p>}
      {data.error && <p className="mt-2 break-words text-destructive">{data.error}</p>}
    </div>
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5" role="tabpanel">
      <div className="mx-auto max-w-4xl">
      {tab === "timeline" ? data.steps.length ? <ol className="relative space-y-5 border-l border-border pl-6 ml-3">{data.steps.map((s, i) => <li key={`${s.time}-${i}`} className="relative">
        <span className="absolute -left-9 top-1 flex h-6 w-6 items-center justify-center bg-background">{s.status === "ok" ? <CheckCircle2 className="h-5 w-5 text-muted-foreground" /> : <SquareTerminal className="h-5 w-5 text-muted-foreground" />}</span>
        <details><summary className="flex cursor-pointer list-none items-start gap-2"><span className={`min-w-0 flex-1 break-words text-base ${s.status === "error" ? "text-destructive" : ""}`}>{s.text}</span><ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></summary>
          {(s.time || s.durationMs != null) && <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">{s.time && <span>{s.time} UTC</span>}{s.durationMs != null && <span>{durationLabel(s.durationMs)}</span>}</div>}
          {s.detail && Object.keys(s.detail).length > 0 && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-3 text-sm">{JSON.stringify(s.detail, null, 2)}</pre>}
        </details>
      </li>)}</ol> : <p className="text-muted-foreground">{running ? "Waiting for recorded steps…" : "No steps were recorded for this run."}</p>
      : data.changes.length ? <div className="space-y-4">{data.changes.map((c, i) => <details key={`${c.path}-${i}`} className="border-b border-border pb-4"><summary className="flex cursor-pointer items-start gap-2"><FilePen className="mt-1 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 break-all text-base">{c.path}</span><span className="text-sm capitalize text-muted-foreground">{c.kind}</span></summary>{c.patch ? <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm">{c.patch.split("\n").map((line, n) => <div key={n} className={line.startsWith("+") ? "text-primary" : line.startsWith("-") ? "text-destructive" : "text-muted-foreground"}>{line || " "}</div>)}</pre> : <p className="mt-3 text-sm text-muted-foreground">{c.unavailable}</p>}</details>)}</div>
      : data.files.length ? <ul className="space-y-3">{data.files.map(f => <li key={f} className="break-all border-b border-border pb-3"><div className="flex items-start gap-2"><FilePen className="h-4 w-4 shrink-0" /><span>{f}</span></div><p className="mt-1 text-sm text-muted-foreground">Saved file list · historical difference unavailable.</p></li>)}</ul> : <p className="text-muted-foreground">No file changes were recorded.</p>}
      </div>
    </main>
  </div>;
}