ALTER TABLE public.chat_jobs ADD COLUMN IF NOT EXISTS work_started_at timestamptz, ADD COLUMN IF NOT EXISTS work_paused_at timestamptz, ADD COLUMN IF NOT EXISTS work_paused_ms bigint NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS visual_check_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.browser_checks ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.chat_jobs(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS trace_id uuid, ADD COLUMN IF NOT EXISTS visual_status text NOT NULL DEFAULT 'not_checked', ADD COLUMN IF NOT EXISTS visual_report text, ADD COLUMN IF NOT EXISTS visual_model text, ADD COLUMN IF NOT EXISTS source_fingerprint text;
CREATE OR REPLACE FUNCTION public.record_job_work_clock() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.status = 'running' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'running') THEN
  NEW.work_started_at := COALESCE(NEW.work_started_at, clock_timestamp());
  IF NEW.work_paused_at IS NOT NULL THEN
   NEW.work_paused_ms := COALESCE(NEW.work_paused_ms,0) + GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp()-NEW.work_paused_at))*1000)::bigint);
   NEW.work_paused_at := NULL;
  END IF;
 END IF;
 IF NEW.outcome = 'paused' AND (TG_OP = 'INSERT' OR OLD.outcome IS DISTINCT FROM 'paused') THEN NEW.work_paused_at := clock_timestamp(); END IF;
 IF NEW.status IN ('completed','failed','stopped','cancelled') AND NEW.outcome IS DISTINCT FROM 'paused' THEN NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp()); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_job_work_clock() FROM PUBLIC;
CREATE TRIGGER chat_job_work_clock BEFORE INSERT OR UPDATE ON public.chat_jobs FOR EACH ROW EXECUTE FUNCTION public.record_job_work_clock();
COMMENT ON COLUMN public.chat_jobs.work_started_at IS 'Authoritative first execution start; null for historical runs without reliable timing.';
CREATE INDEX IF NOT EXISTS browser_checks_job_idx ON public.browser_checks(job_id,created_at);