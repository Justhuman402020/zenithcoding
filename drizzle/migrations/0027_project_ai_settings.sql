CREATE TABLE public.project_ai_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cloudflare_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'off',
  last_error text,
  last_reply text,
  last_checked_at timestamptz,
  token_hash text UNIQUE,
  model text,
  usage_day date,
  day_requests integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_ai_settings TO authenticated;
GRANT ALL ON public.project_ai_settings TO service_role;
ALTER TABLE public.project_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their project AI settings" ON public.project_ai_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());