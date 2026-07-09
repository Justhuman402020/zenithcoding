
-- Per-published-site auth and data (shared Forge backend, isolated by project_id via RLS-off + service-role access)
CREATE TABLE public.site_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);
CREATE INDEX site_users_project_idx ON public.site_users(project_id);
GRANT ALL ON public.site_users TO service_role;
ALTER TABLE public.site_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project owners see their site users"
  ON public.site_users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_users.project_id AND p.user_id = auth.uid()));

CREATE TABLE public.site_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_user_id UUID NOT NULL REFERENCES public.site_users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_sessions_user_idx ON public.site_sessions(site_user_id);
GRANT ALL ON public.site_sessions TO service_role;
ALTER TABLE public.site_sessions ENABLE ROW LEVEL SECURITY;
-- no user-facing policies; only service_role touches this table

CREATE TABLE public.site_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  owner_site_user_id UUID REFERENCES public.site_users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_data_lookup_idx ON public.site_data(project_id, collection);
CREATE INDEX site_data_owner_idx ON public.site_data(owner_site_user_id);
GRANT ALL ON public.site_data TO service_role;
ALTER TABLE public.site_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project owners see their site data"
  ON public.site_data FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_data.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER site_users_touch BEFORE UPDATE ON public.site_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER site_data_touch BEFORE UPDATE ON public.site_data FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
