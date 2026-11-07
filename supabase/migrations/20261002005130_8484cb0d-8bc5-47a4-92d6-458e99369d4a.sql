CREATE TABLE public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  handle text NOT NULL,
  url text NOT NULL,
  storage_path text NOT NULL,
  content_type text,
  size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, handle)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assets TO authenticated;
GRANT ALL ON public.project_assets TO service_role;
ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage assets" ON public.project_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users upload own project assets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own project assets" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-assets' AND (storage.foldername(name))[1] = auth.uid()::text);