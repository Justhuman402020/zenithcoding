
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_key ON public.projects (slug) WHERE slug IS NOT NULL;

-- Allow anonymous readers to see published projects (for the public site viewer)
GRANT SELECT ON public.projects TO anon;
GRANT SELECT ON public.files TO anon;

DROP POLICY IF EXISTS "public can read published projects" ON public.projects;
CREATE POLICY "public can read published projects"
  ON public.projects FOR SELECT
  TO anon
  USING (published = true);

DROP POLICY IF EXISTS "public can read files of published projects" ON public.files;
CREATE POLICY "public can read files of published projects"
  ON public.files FOR SELECT
  TO anon
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = files.project_id AND p.published = true));
