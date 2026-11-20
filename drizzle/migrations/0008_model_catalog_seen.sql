CREATE TABLE IF NOT EXISTS public.model_catalog_seen (
  model_id text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed boolean NOT NULL DEFAULT false
);
GRANT ALL ON public.model_catalog_seen TO service_role;
ALTER TABLE public.model_catalog_seen ENABLE ROW LEVEL SECURITY;