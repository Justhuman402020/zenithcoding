export const MICROLINK_BASE_URL = "https://pro.microlink.io";

export function isScreenshotKey(row: { base_url: string | null }): boolean {
  try { return new URL(row.base_url ?? "").origin === MICROLINK_BASE_URL; }
  catch { return false; }
}

/** Only explicit provider refusal/quota responses move to another saved key. */
export function nextScreenshotKey(status: number): boolean {
  return [401, 403, 429].includes(status);
}