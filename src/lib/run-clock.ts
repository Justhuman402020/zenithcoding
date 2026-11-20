export type RunClock = {
  status?: string; outcome?: string | null; work_started_at?: string | null;
  completed_at?: string | null; work_paused_at?: string | null; work_paused_ms?: number;
};
export function runClock(clock: RunClock, now: number) {
  const paused = clock.outcome === "paused" || clock.status === "paused";
  const running = clock.status === "running" && !paused;
  const label = paused ? "Paused" : clock.status === "queued" ? "Waiting" : running ? "Working for" : "Worked for";
  const start = Date.parse(clock.work_started_at ?? "");
  const end = Date.parse((paused ? clock.work_paused_at : clock.completed_at) ?? "");
  if (!Number.isFinite(start)) return { label, ms: null, running };
  if (!running && !Number.isFinite(end)) return { label, ms: null, running };
  return { label, ms: Math.max(0, (running ? now : end) - start - (clock.work_paused_ms ?? 0)), running };
}