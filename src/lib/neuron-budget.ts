// Pure Neuron budgeting + handoff "baton" helpers shared by the chat loop and tests.

export const SOFT_CAP = 9_000;
export const HARD_CEILING = 9_200;
export const LOOKAHEAD_MARGIN = 1.25;

/** Projected total after the next step, based on recent step costs. */
export function projectNextTotal(total: number, stepCosts: number[]): number {
  if (!stepCosts.length) return total;
  const last = stepCosts[stepCosts.length - 1]!;
  const avg = stepCosts.reduce((a, b) => a + b, 0) / stepCosts.length;
  return total + Math.max(last, avg) * LOOKAHEAD_MARGIN;
}

/** True when this key must stop now and hand off before the next step. */
export function shouldHandoff(total: number, stepCosts: number[]): boolean {
  if (total >= SOFT_CAP) return true;
  return projectNextTotal(total, stepCosts) > SOFT_CAP;
}

export type BatonItem = { title: string; status: "done" | "in_progress" | "left" };
export type Baton = {
  items: BatonItem[];
  files: string[];
  next: string;
  keyLog: { key: string; neurons: number; items: string }[];
};

export const emptyBaton = (): Baton => ({ items: [], files: [], next: "", keyLog: [] });

export function mergeBaton(base: Baton, patch: Partial<Baton>): Baton {
  return {
    items: patch.items?.length ? patch.items : base.items,
    files: [...new Set([...(base.files ?? []), ...(patch.files ?? [])])].slice(-40),
    next: patch.next ?? base.next,
    keyLog: [...(base.keyLog ?? []), ...(patch.keyLog ?? [])].slice(-30),
  };
}

/** The first message the next key reads. */
export function batonNote(b: Baton, nextKeyLabel: string): string {
  const items = b.items.length
    ? b.items.map((it, i) => `${i + 1}. [${it.status === "done" ? "x" : it.status === "in_progress" ? "~" : " "}] ${it.title}`).join("\n")
    : "(no item list saved — continue the original request)";
  const log = b.keyLog.map((k) => `- ${k.key}: ${k.neurons} Neurons · ${k.items}`).join("\n") || "- none yet";
  return [
    `Handoff baton — you are ${nextKeyLabel}, continuing the same job as the same agent (the user must not notice a switch).`,
    `Plan progress:\n${items}`,
    `Files already saved and showing in preview (trust them, do NOT rewrite): ${b.files.slice(-25).join(", ") || "none"}`,
    `Previous keys:\n${log}`,
    `Next action: ${b.next || "do the first item not marked [x]"}`,
    `Rules: you have a 9,000 Neuron soft cap (1,000 reserve). Plan how many items fit, work them, and before you run low call update_handoff with item statuses and the next action so the next key can continue. Typecheck/build counts as an item.`,
  ].join("\n\n");
}
