import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, ListChecks, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseWorkLog, workedFor, rememberChatScroll } from "@/lib/work-log";
import { durationLabel } from "@/lib/work-log";
import { useRunClock } from "@/hooks/use-run-clock";
import type { RunClock } from "@/lib/run-clock";

export function WorkLogCard({
  log = "",
  title,
  checks,
  projectId,
  runId,
  chatId,
  running = false,
  progress,
  stepCount,
  fileCount,
  clock: savedClock,
}: {
  log?: string;
  title: string;
  checks?: ReactNode;
  projectId: string;
  runId: string;
  chatId?: string;
  running?: boolean;
  progress?: string;
  stepCount?: number;
  fileCount?: number;
  clock?: RunClock;
}) {
  const { steps, files } = parseWorkLog(log);
  const clock = useRunClock(savedClock ?? {});
  const dur = clock.ms == null ? workedFor(steps) : durationLabel(clock.ms);
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <Link
        to="/work/$projectId/$runId"
        params={{ projectId, runId }}
        search={{ chatId }}
        onClick={() => rememberChatScroll(projectId, chatId)}
        className="block"
        aria-label={`Work log: ${title}`}
      >
        <div className="flex items-start gap-2">
          <ListChecks className="mt-1 h-4 w-4 shrink-0 text-primary" />
          <span className="line-clamp-2 min-w-0 flex-1 break-words text-base font-medium">
            {title || "Build"}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span className="line-clamp-1 min-w-0 break-all">
            {progress ||
              (running ? "Working…" : (steps[steps.length - 1]?.text ?? "Saved work log"))}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {dur && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {clock.ms == null ? "" : `${clock.label} `}{dur}
            </span>
          )}
          <span>
            {stepCount ?? steps.length} steps · {fileCount ?? files.length} files
          </span>
        </div>
      </Link>
      <Button asChild variant="ghost" size="sm" className="mt-1 h-7 px-0 text-muted-foreground">
        <Link
          to="/work/$projectId/$runId"
          params={{ projectId, runId }}
          search={{ chatId }}
          onClick={() => rememberChatScroll(projectId, chatId)}
        >
          Details
        </Link>
      </Button>
      {checks && (
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer">Checks</summary>
          <div className="mt-2">{checks}</div>
        </details>
      )}
    </div>
  );
}
