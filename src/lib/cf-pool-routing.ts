const CF_RE = /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai/i;

/** Removes Cloudflare Workers AI providers (used for images always, and for coding when the pool is off). */
export function withoutCloudflare<T extends { baseURL: string }>(providers: T[]): T[] {
  return providers.filter((p) => !CF_RE.test(p.baseURL));
}
