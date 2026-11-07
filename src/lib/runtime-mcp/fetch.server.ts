export const mcpFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("Scrolltide redirected unexpectedly.");
  return response;
};