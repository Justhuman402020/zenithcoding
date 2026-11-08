CREATE TABLE public.preview_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  html text NOT NULL,
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.preview_tokens TO service_role;
ALTER TABLE public.preview_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.browser_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  target text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  error_short text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.browser_checks TO authenticated;
GRANT ALL ON public.browser_checks TO service_role;
ALTER TABLE public.browser_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own checks" ON public.browser_checks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX browser_checks_project_idx ON public.browser_checks (project_id, created_at DESC);