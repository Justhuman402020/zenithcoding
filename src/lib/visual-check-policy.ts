export function visualCheckRequested(text: string) {
  return /\b(screenshot|visual(?:ly)? (?:check|test|verify)|(?:see|inspect|test|check) (?:my |the )?preview)\b/i.test(text)
    || /\b(?:fix|repair|debug|diagnose)\b[^.!?\n]{0,100}\bpreview\b/i.test(text)
    || /\bpreview\b[^.!?\n]{0,100}\b(?:blank|broken|error|fail(?:ed|ing|ure)?|not (?:working|loading|showing))\b/i.test(text);
}
export function parseVisualReport(text: string): { status: "passed" | "problems" | "unverified"; report: string } {
  const cleaned = text.trim();
  const status = /^PASS\b/i.test(cleaned) ? "passed" : /^PROBLEMS\b/i.test(cleaned) ? "problems" : "unverified";
  return { status, report: cleaned.slice(0, 12000) || "The image reader did not return a visual assessment." };
}
export function visualRoundAllowed(count: number) { return count < 3; }

/** Task-scoped automatic inspection; conversation and invisible configuration do not spend capture credit. */
export function visualVerificationNeeded(text: string, changesFiles: boolean) {
  if (visualCheckRequested(text)) return true;
  return changesFiles && /\b(page|site|website|layout|theme|style|css|image|photo|navigation|menu|button|form|mobile|desktop|zip|template|preview|ui|screen)\b/i.test(text);
}