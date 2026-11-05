export function visualCheckRequested(text: string) {
  return /\b(screenshot|visual(?:ly)? (?:check|test|verify)|(?:see|inspect|test|check) (?:my |the )?preview)\b/i.test(text);
}
export function parseVisualReport(text: string): { status: "passed" | "problems" | "unverified"; report: string } {
  const cleaned = text.trim();
  const status = /^PASS\b/i.test(cleaned) ? "passed" : /^PROBLEMS\b/i.test(cleaned) ? "problems" : "unverified";
  return { status, report: cleaned.slice(0, 12000) || "The image reader did not return a visual assessment." };
}
export function visualRoundAllowed(count: number) { return count < 3; }