DROP POLICY IF EXISTS "Signed-in users can read model settings" ON public.ai_model_settings;
DROP POLICY IF EXISTS "Signed-in users can read model status" ON public.ai_model_status;
REVOKE ALL ON public.ai_model_settings, public.ai_model_status FROM anon, authenticated;
GRANT ALL ON public.ai_model_settings, public.ai_model_status TO service_role;