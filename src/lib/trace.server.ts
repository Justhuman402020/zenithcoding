// Request tracing for AI chat edits.
// Every step of a build (auth, credits, model pick, each tool call, stream end)
// is logged to the console AND persisted to public.chat_traces so a failed edit
// can be diagnosed in production without reproducing it locally.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TraceStatus = "ok" | "error" | "warn";

export type TraceLogOptions = {
  status?: TraceStatus;
  message?: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
};

export type TraceLogger = {
  traceId: string;
  log: (phase: string, options?: TraceLogOptions) => void;
  time: <T>(phase: string, fn: () => Promise<T>, detail?: Record<string, unknown>) => Promise<T>;
  flush: () => Promise<void>;
};

type TraceRow = {
  trace_id: string;
  project_id: string;
  user_id: string;
  seq: number;
  phase: string;
  status: TraceStatus;
  message: string | null;
  detail: Record<string, unknown>;
  duration_ms: number | null;
};

function newTraceId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Truncates long values so a trace row never stores a whole file. */
function trim(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    out[key] = typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return out;
}

export function createTrace(params: {
  projectId: string;
  userId: string;
  traceId?: string;
  /** Persist to the database. Off in tests. */
  persist?: boolean;
}): TraceLogger {
  const traceId = params.traceId ?? newTraceId();
  const persist = params.persist !== false;
  let seq = 0;
  let pending: TraceRow[] = [];
  let inFlight: Promise<void> = Promise.resolve();

  async function flush(): Promise<void> {
    if (!persist || pending.length === 0) return;
    const batch = pending;
    pending = [];
    inFlight = inFlight.then(async () => {
      const { error } = await supabaseAdmin.from("chat_traces").insert(batch as never);
      if (error) console.error(`[trace ${traceId}] persist failed`, error.message);
    });
    await inFlight;
  }

  function log(phase: string, options: TraceLogOptions = {}) {
    const status = options.status ?? "ok";
    const row: TraceRow = {
      trace_id: traceId,
      project_id: params.projectId,
      user_id: params.userId,
      seq: seq++,
      phase,
      status,
      message: options.message ?? null,
      detail: trim(options.detail),
      duration_ms: options.durationMs ?? null,
    };
    const line = `[trace ${traceId}] ${phase} ${status}${options.durationMs != null ? ` ${options.durationMs}ms` : ""}`;
    if (status === "error") console.error(line, options.message ?? "", row.detail);
    else console.log(line, row.detail);
    pending.push(row);
    if (pending.length >= 10) void flush();
  }

  async function time<T>(phase: string, fn: () => Promise<T>, detail?: Record<string, unknown>): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      log(phase, { durationMs: Date.now() - started, detail });
      return result;
    } catch (error) {
      log(phase, {
        status: "error",
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
        detail,
      });
      throw error;
    }
  }

  return { traceId, log, time, flush };
}
