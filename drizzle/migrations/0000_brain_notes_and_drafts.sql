CREATE TABLE public.project_brain_notes (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_brain_notes TO authenticated;
GRANT ALL ON public.project_brain_notes TO service_role;
ALTER TABLE public.project_brain_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner brain notes" ON public.project_brain_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

CREATE TABLE public.project_drafts (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  text text NOT NULL DEFAULT '',
  device_id text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_drafts TO authenticated;
GRANT ALL ON public.project_drafts TO service_role;
ALTER TABLE public.project_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own drafts" ON public.project_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE public.project_drafts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_drafts;