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