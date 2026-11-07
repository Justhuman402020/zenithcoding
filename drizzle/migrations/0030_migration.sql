DROP POLICY IF EXISTS "Signed-in users can read AI pool settings" ON public.ai_pool_settings;
REVOKE ALL ON public.ai_pool_settings FROM anon, authenticated;
GRANT ALL ON public.ai_pool_settings TO service_role;