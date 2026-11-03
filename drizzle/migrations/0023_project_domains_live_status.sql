ALTER TABLE public.project_domains
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'waiting_records',
  ADD COLUMN IF NOT EXISTS ssl_status text,
  ADD COLUMN IF NOT EXISTS dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;