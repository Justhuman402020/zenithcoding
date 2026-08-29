CREATE TABLE public.custom_ai_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_encrypted TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.custom_ai_providers TO service_role;
ALTER TABLE public.custom_ai_providers ENABLE ROW LEVEL SECURITY;