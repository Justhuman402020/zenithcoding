/** Only an authoritative access denial may send a signed-in owner away. */
export function isWorkspaceAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.message === "Not available";
}

/** SIGNED_IN also fires on tab wake; revalidate only an identity transition. */
export function authIdentityChanged(previous: string | null, next: string | null) {
  return previous !== next;
}