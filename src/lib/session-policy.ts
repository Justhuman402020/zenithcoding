/** Only an authoritative access denial may send a signed-in owner away. */
export function isWorkspaceAccessDenied(error: unknown): boolean {
  return error instanceof Error && error.message === "Not available";
}