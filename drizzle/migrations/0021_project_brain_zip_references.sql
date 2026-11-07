CREATE TABLE public.project_brain_zips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, name text NOT NULL, storage_path text NOT NULL UNIQUE, byte_size bigint NOT NULL,
 manifest jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.project_brain_zips TO authenticated;
GRANT ALL ON public.project_brain_zips TO service_role;
ALTER TABLE public.project_brain_zips ENABLE ROW LEVEL SECURITY;
CREATE POLICY brain_zip_owner_read ON public.project_brain_zips FOR SELECT TO authenticated USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY brain_zip_owner_insert ON public.project_brain_zips FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND storage_path LIKE auth.uid()::text || '/' || project_id::text || '/%' AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY brain_zip_owner_delete ON public.project_brain_zips FOR DELETE TO authenticated USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY brain_zip_storage_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'project-brain-zips' AND (storage.foldername(name))[1] = auth.uid()::text AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = (storage.foldername(name))[2] AND p.user_id = auth.uid()));
CREATE POLICY brain_zip_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'project-brain-zips' AND (storage.foldername(name))[1] = auth.uid()::text AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = (storage.foldername(name))[2] AND p.user_id = auth.uid()));
CREATE POLICY brain_zip_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'project-brain-zips' AND (storage.foldername(name))[1] = auth.uid()::text AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id::text = (storage.foldername(name))[2] AND p.user_id = auth.uid()));