// One real Playwright browser per build task, kept warm in an E2B sandbox so
// every use after the first takes seconds. Calls run one at a time.
import type { E2BSandbox } from "./integration-keys.server";
import { BROWSER_IDLE_SECONDS, BROWSER_RUN_SECONDS, readBrowserResult, type BrowserRunResult, type BrowserTarget } from "./browser-steps";

export type BrowserSession = {
  run(code: string): Promise<{ ok: true; result: BrowserRunResult; firstUse: boolean } | { ok: false; error: string }>;
  last: BrowserTarget | null;
  close(): Promise<void>;
};

export function createBrowserSession(): BrowserSession {
  let sandbox: E2BSandbox | null = null;
  let installed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const k = () => import("./integration-keys.server");

  const ensure = async () => {
    const { e2bCreateSandbox, e2bExtend } = await k();
    if (sandbox && (await e2bExtend(sandbox, BROWSER_IDLE_SECONDS))) return sandbox;
    sandbox = null; installed = false;
    const created = await e2bCreateSandbox(BROWSER_IDLE_SECONDS);
    if (!created.ok) throw new Error(created.error);
    sandbox = created.sandbox;
    return sandbox;
  };

  const once = async (code: string) => {
    const { e2bExecute } = await k();
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const sb = await ensure();
      const firstUse = !installed;
      const r = await e2bExecute(sb, code, { timeoutSec: BROWSER_RUN_SECONDS + (firstUse ? 320 : 30), maxOut: 900_000 });
      if (!r.ok) {
        lastError = r.error;
        if (r.gone) { sandbox = null; continue; }
        return { ok: false as const, error: r.error };
      }
      const result = readBrowserResult(r.stdout);
      if (!result) return { ok: false as const, error: `Browser gave no result. ${r.stderr.slice(0, 300)}` };
      if (!result.fatal) installed = true;
      return { ok: true as const, result, firstUse };
    }
    return { ok: false as const, error: lastError || "The browser sandbox stopped answering." };
  };

  const session: BrowserSession = {
    last: null,
    run(code) {
      const next = queue.then(() => once(code), () => once(code));
      queue = next.catch(() => {});
      return next.catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "browser sandbox error" }));
    },
    async close() {
      const sb = sandbox; sandbox = null;
      if (sb) await (await k()).e2bKill(sb);
    },
  };
  return session;
}
