CREATE TABLE public.project_github_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  owner text NOT NULL,
  repo text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  last_pushed_branch text,
  last_pushed_sha text,
  last_pushed_message text,
  last_pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_github_links TO authenticated;
GRANT ALL ON public.project_github_links TO service_role;
ALTER TABLE public.project_github_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own project_github_links" ON public.project_github_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER touch_project_github_links_updated_at
  BEFORE UPDATE ON public.project_github_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();