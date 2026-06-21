CREATE TABLE public.project_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  hostname text NOT NULL,
  verification_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  last_check_at timestamptz,
  last_check_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hostname)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_domains TO authenticated;
GRANT SELECT ON public.project_domains TO anon;
GRANT ALL ON public.project_domains TO service_role;

ALTER TABLE public.project_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own project domains" ON public.project_domains
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "anon can read verified domains for routing" ON public.project_domains
  FOR SELECT TO anon USING (verified = true);

CREATE TRIGGER touch_project_domains BEFORE UPDATE ON public.project_domains
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX project_domains_project_idx ON public.project_domains(project_id);
CREATE INDEX project_domains_hostname_idx ON public.project_domains(hostname);