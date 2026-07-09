
CREATE TABLE public.project_secrets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  expose_to_client BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);
CREATE INDEX project_secrets_project_idx ON public.project_secrets(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_secrets TO authenticated;
GRANT ALL ON public.project_secrets TO service_role;
ALTER TABLE public.project_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their project secrets metadata"
  ON public.project_secrets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Owners insert their project secrets"
  ON public.project_secrets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update their project secrets"
  ON public.project_secrets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete their project secrets"
  ON public.project_secrets FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE TRIGGER project_secrets_touch BEFORE UPDATE ON public.project_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX share_links_project_idx ON public.share_links(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_links TO authenticated;
GRANT ALL ON public.share_links TO service_role;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their share links"
  ON public.share_links FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
