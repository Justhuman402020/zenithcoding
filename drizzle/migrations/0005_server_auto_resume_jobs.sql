-- lovable-cron-fallback-reviewed: armed only while builds run (wake-on-enqueue) and unscheduled after drain; Workers cut background work ~30s after disconnect so a time-based restart is required.
ALTER TABLE public.chat_jobs
  ADD COLUMN IF NOT EXISTS resume_payload jsonb,
  ADD COLUMN IF NOT EXISTS auto_resumes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.job_resume_config (
  id text PRIMARY KEY DEFAULT 'default',
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex')
);
GRANT ALL ON public.job_resume_config TO service_role;
ALTER TABLE public.job_resume_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.job_resume_config (id) VALUES ('default') ON CONFLICT DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.arm_job_resume()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'code-haven-resume-jobs') THEN RETURN; END IF;
  PERFORM cron.schedule('code-haven-resume-jobs', '* * * * *', $cron$
    SELECT net.http_post(
      url := 'https://project--4cd30b31-2a37-4c66-9cee-ab3d574ad805.lovable.app/api/public/jobs/resume',
      headers := jsonb_build_object('Content-Type','application/json','x-resume-token',(SELECT token FROM public.job_resume_config WHERE id='default')),
      body := '{}'::jsonb,
      timeout_milliseconds := 600000
    )
    WHERE EXISTS (SELECT 1 FROM public.chat_jobs WHERE status IN ('queued','running') AND resume_payload IS NOT NULL AND auto_resumes < 6 AND updated_at < now() - interval '90 seconds');
    SELECT public.disarm_job_resume_if_idle();
  $cron$);
END $$;

CREATE OR REPLACE FUNCTION public.disarm_job_resume_if_idle()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_jobs WHERE status IN ('queued','running') AND resume_payload IS NOT NULL AND auto_resumes < 6 AND updated_at > now() - interval '2 hours') THEN
    PERFORM cron.unschedule('code-haven-resume-jobs');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

REVOKE ALL ON FUNCTION public.arm_job_resume() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disarm_job_resume_if_idle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_job_resume() TO service_role;
GRANT EXECUTE ON FUNCTION public.disarm_job_resume_if_idle() TO service_role;