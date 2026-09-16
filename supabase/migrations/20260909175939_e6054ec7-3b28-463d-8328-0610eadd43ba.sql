CREATE TABLE public.chat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress text,
  assistant_reply text,
  error text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, project_id, request_key)
);
GRANT SELECT, INSERT ON public.chat_jobs TO authenticated;
GRANT ALL ON public.chat_jobs TO service_role;
ALTER TABLE public.chat_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own chat jobs" ON public.chat_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create own chat jobs" ON public.chat_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX chat_jobs_project_created_idx ON public.chat_jobs (project_id, created_at DESC);
CREATE INDEX chat_jobs_active_idx ON public.chat_jobs (user_id, project_id, status) WHERE status IN ('queued', 'running');
CREATE OR REPLACE FUNCTION public.set_chat_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER chat_jobs_set_updated_at BEFORE UPDATE ON public.chat_jobs FOR EACH ROW EXECUTE FUNCTION public.set_chat_jobs_updated_at();