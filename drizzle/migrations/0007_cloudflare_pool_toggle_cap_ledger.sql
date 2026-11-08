ALTER TABLE public.ai_pool_settings
  ADD COLUMN IF NOT EXISTS cloudflare_pool_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_cap_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_cap integer NOT NULL DEFAULT 0;
ALTER TABLE public.chat_jobs
  ADD COLUMN IF NOT EXISTS pool_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pool_ledger jsonb,
  ADD COLUMN IF NOT EXISTS paused_at_key integer;
CREATE UNIQUE INDEX IF NOT EXISTS chat_jobs_one_pool_run
  ON public.chat_jobs ((pool_run)) WHERE pool_run AND status IN ('queued','running');
COMMENT ON COLUMN public.ai_model_settings.auto_fallback IS 'DEPRECATED: replaced by ai_pool_settings.cloudflare_pool_enabled';