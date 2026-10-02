// Keeps the server worker alive for background work after the HTTP response
// (and the browser connection) is gone. server.ts stores each request's
// execution context here; long jobs call keepAlive(promise).
import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { waitUntil?: (p: Promise<unknown>) => void } | undefined;

export const requestCtx = new AsyncLocalStorage<Ctx>();

export function keepAlive(promise: Promise<unknown>) {
  const ctx = requestCtx.getStore();
  const safe = promise.catch((e) => console.error("[background job]", e));
  try {
    ctx?.waitUntil?.(safe);
  } catch {
    /* runtime without waitUntil: the promise still runs */
  }
}
