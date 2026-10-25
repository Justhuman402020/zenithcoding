export const OWNER_EMAIL = "justsamsung99@gmail.com";
export function isOwner(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined) {
  return user?.email?.toLowerCase() === OWNER_EMAIL && !!user.email_confirmed_at;
}
export type BuildEngine = "openrouter" | "cloudflare";
export function engineFor(mode: "plan" | "build", saved: BuildEngine, snapshot?: BuildEngine | null): BuildEngine {
  return mode === "plan" ? "cloudflare" : snapshot ?? saved;
}
export const ACCOUNT_ALLOWANCE = 10_000;
export const ACCOUNT_GUARD = 9_500;
export const ACCOUNT_COUNT = 60;
export function sectionTotals(rows: Array<{ section: string; neurons: number }>) {
  return rows.reduce((t, r) => ({ ...t, [r.section]: (t[r.section as keyof typeof t] ?? 0) + Number(r.neurons) }), { chat: 0, plan: 0, build: 0 });
}
export function successfulEdit(job: { status: string; outcome?: string | null; error?: string | null }) {
  return job.status === "completed" && job.outcome === "finished" && !job.error;
}