export function validOAuthReturn(state: string | null, code: string | null, expiry: string | null, now = Date.now()) {
  return Boolean(state && /^[0-9a-f-]{36}$/i.test(state) && code && code.length <= 4096 && expiry && new Date(expiry).getTime() > now);
}
export function canUseTemplateDraft(draft: { state: string; user_id: string; project_id: string; request_key?: string | null }, userId: string, projectId: string, requestKey: string, resume: boolean) {
  return draft.user_id === userId && draft.project_id === projectId && (resume ? draft.state === "dispatched" && draft.request_key === requestKey : draft.state === "approved");
}