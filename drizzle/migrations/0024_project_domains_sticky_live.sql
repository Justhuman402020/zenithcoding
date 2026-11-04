ALTER TABLE public.project_domains ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.project_domains ADD COLUMN IF NOT EXISTS first_failure_at timestamptz;