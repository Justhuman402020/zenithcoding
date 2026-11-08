export function getCanonicalCallbackUrl() {
  return (
    process.env.GITHUB_OAUTH_CALLBACK_URL ||
    "https://zenithcoding.lovable.app/api/public/github/callback"
  );
}

export function currentOrigin(req: Request | undefined): string {
  const host = req?.headers.get("x-forwarded-host") || req?.headers.get("host") || "localhost:3000";
  const proto = req?.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function encodeReturnOrigin(origin: string): string {
  return btoa(origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const GITHUB_USER_AGENT = "CodeHaven/1.0";

/** fetch() that always sends the User-Agent GitHub requires (it answers 403 without one). */
export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", GITHUB_USER_AGENT);
  return globalThis.fetch(input, { ...init, headers });
}
