/** Build runs must edit or report a blocker; looking around alone may not run forever. */
export const LOOK_ONLY_NUDGE = 6;
export const LOOK_ONLY_STOP = 10;
export function lookOnlyAction(stepsWithoutEdit: number, needsFileChange: boolean): "none" | "nudge" | "stop" {
  if (!needsFileChange) return "none";
  if (stepsWithoutEdit >= LOOK_ONLY_STOP) return "stop";
  return stepsWithoutEdit >= LOOK_ONLY_NUDGE ? "nudge" : "none";
}
export const LOOK_ONLY_NOTE = `## Edit now\nYou have spent ${LOOK_ONLY_NUDGE}+ steps only reading or querying without changing a file. In this step, either make the edit you already have enough evidence for, or stop and tell the user exactly what is blocking you (missing access, a command they must run). Do not keep investigating.`;
