export const SCREENSHOTONE_BASE_URL = "https://api.screenshotone.com";
/** admin_brain row that stores the id of the one screenshot key the owner turned on. */
export const ACTIVE_SCREENSHOT_ROW = "screenshot_active";

export function isScreenshotKey(row: { base_url: string | null }): boolean {
  try { return new URL(row.base_url ?? "").origin === SCREENSHOTONE_BASE_URL; }
  catch { return false; }
}

/** The agent uses only the key the owner turned on — never another saved key. */
export function pickActiveKey<T extends { id: string }>(rows: T[], activeId: string | null): T | null {
  return rows.find((r) => r.id === activeId) ?? null;
}

export function screenshotOneUrl(accessKey: string, url: string, vp: { width: number; height: number }, mobile: boolean, fullPage = false) {
  const q = new URLSearchParams({
    access_key: accessKey, url, format: "jpg", image_quality: "80",
    viewport_width: String(vp.width), viewport_height: String(vp.height),
    viewport_mobile: String(mobile), device_scale_factor: "1", full_page: String(fullPage),
    block_cookie_banners: "true", block_ads: "true", wait_until: "networkidle0", delay: "2", timeout: "60", cache: "false",
  });
  return `${SCREENSHOTONE_BASE_URL}/take?${q}`;
}
