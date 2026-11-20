/** Only an authoritative access denial may send a signed-in owner away. */
export function isWorkspaceAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.message === "Not available";
}

/** SIGNED_IN also fires on tab wake; revalidate only an identity transition. */
export function authIdentityChanged(previous: string | null, next: string | null) {
  return previous !== next;
}
/** Sign-in is required only when the auth server actually rejects the session. */
export function isSessionRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; name?: string };
  if (e.name === "AuthSessionMissingError") return true;
  return e.status === 401 || e.status === 403;
}
