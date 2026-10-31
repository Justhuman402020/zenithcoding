import { MAX_FIX_ROUNDS } from "./browser-check-policy";

/** Quiet time with no errors before an imported ZIP counts as clean. */
export const ZIP_QUIET_MS = 8000;
/** Wait after a fix finishes so the preview rebuilds before checking again. */
export const ZIP_SETTLE_MS = 5000;

export type ZipCheckDecision =
  | { action: "pass" }
  | { action: "fix"; round: number; report: string }
  | { action: "stop"; reason: string };

/** After a ZIP import: pass when clean, otherwise fix with the build model, at most MAX_FIX_ROUNDS times. */
export function zipCheckDecision(input: { buildError?: string | null; previewError?: string | null; roundsUsed: number }): ZipCheckDecision {
  const report = input.buildError
    ? `The project could not be built for the preview:\n${input.buildError}`
    : input.previewError || "";
  if (!report.trim()) return { action: "pass" };
  if (input.roundsUsed >= MAX_FIX_ROUNDS) {
    return { action: "stop", reason: `Still broken after ${MAX_FIX_ROUNDS} automatic fixes: ${report.slice(0, 300)}` };
  }
  return { action: "fix", round: input.roundsUsed + 1, report };
}

export function zipFixPrompt(report: string, round: number) {
  return `This project was just imported from a ZIP and the preview has an error (automatic fix ${round} of ${MAX_FIX_ROUNDS}). Fix the root cause so the site looks and works exactly like the original template. Change only what is needed — do not redesign, remove sections or rewrite unrelated code:\n\n${report}`;
}
