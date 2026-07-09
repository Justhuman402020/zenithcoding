ALTER TABLE public.files ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'source';
CREATE INDEX IF NOT EXISTS files_project_kind_idx ON public.files (project_id, kind);