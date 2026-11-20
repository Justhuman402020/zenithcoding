CREATE TABLE IF NOT EXISTS public.platform_supabase_connection (
  id TEXT PRIMARY KEY DEFAULT 'global',
  project_url TEXT NOT NULL,
  anon_key_encrypted TEXT NOT NULL,
  service_key_encrypted TEXT,
  label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.platform_supabase_connection TO service_role;

ALTER TABLE public.platform_supabase_connection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read the platform backend connection"
ON public.platform_supabase_connection
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));