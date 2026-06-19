CREATE TABLE public.project_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT 'auto',
  files JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX project_snapshots_project_created_idx ON public.project_snapshots (project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_snapshots TO authenticated;
GRANT ALL ON public.project_snapshots TO service_role;

ALTER TABLE public.project_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own snapshots" ON public.project_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);