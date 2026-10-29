export const RECOVERY_HEADERS = ["x-forge-model", "x-forge-auto", "x-forge-mode", "x-forge-clone", "x-forge-vision-model", "x-forge-engine", "x-forge-image-build", "x-forge-approval", "x-forge-approved", "x-forge-pool-from"] as const;

/** Persist the chosen mode/model alongside input; a restart must not reselect it. */
export function recoveryHeaders(headers: Headers, snapshot?: { engine: string; provider: string; model: string }) {
  const saved: Record<string, string> = {};
  for (const name of RECOVERY_HEADERS) {
    const value = headers.get(name);
    if (value !== null) saved[name] = value;
  }
  if (snapshot) {
    saved["x-forge-engine"] = snapshot.engine;
    saved["x-forge-model"] = `${snapshot.provider}:${snapshot.model}`;
  }
  return saved;
}
/** Single-model builds retry the same model up to 3 times on silence, rate limits, 5xx or network drops. */
export function shouldRetrySameModel(error: string | null, timedOut: boolean, retries: number) {
  if (retries >= 3) return false;
  if (timedOut) return true;
  const e = error ?? "";
  if (/\b(401|402|403|404)\b|invalid api key|unauthori[sz]ed|insufficient|credits/i.test(e)) return false;
  return /sent nothing|timed? ?out|\b(429|5\d\d)\b|rate.?limit|overloaded|network|fetch failed|socket|ECONN|terminated|stream|returned nothing/i.test(e);
}
