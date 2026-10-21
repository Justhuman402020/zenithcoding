// Checks the private token used by the server to restart its own cut-off builds.
export async function verifyResumeToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("job_resume_config")
    .select("token")
    .eq("id", "default")
    .maybeSingle();
  const expected: string | undefined = data?.token;
  if (!expected || expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
