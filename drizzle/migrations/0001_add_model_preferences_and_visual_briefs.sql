CREATE TABLE public.ai_pool_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  coding_model TEXT NOT NULL DEFAULT '@cf/qwen/qwen3.8-27b',
  vision_provider TEXT,
  vision_model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
GRANT SELECT ON public.ai_pool_settings TO authenticated;
GRANT ALL ON public.ai_pool_settings TO service_role;
ALTER TABLE public.ai_pool_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read AI pool settings"
ON public.ai_pool_settings FOR SELECT TO authenticated USING (true);

CREATE TABLE public.project_visual_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_name TEXT,
  vision_provider TEXT NOT NULL,
  vision_model TEXT NOT NULL,
  brief TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_visual_briefs TO authenticated;
GRANT ALL ON public.project_visual_briefs TO service_role;
ALTER TABLE public.project_visual_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own project visual briefs"
ON public.project_visual_briefs FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX project_visual_briefs_project_created_idx
ON public.project_visual_briefs (project_id, created_at DESC);