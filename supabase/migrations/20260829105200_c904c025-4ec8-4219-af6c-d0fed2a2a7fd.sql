CREATE TABLE public.chat_traces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trace_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  seq INT NOT NULL DEFAULT 0,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  message TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_traces_project_created_idx ON public.chat_traces (project_id, created_at DESC);
CREATE INDEX chat_traces_trace_idx ON public.chat_traces (trace_id);

GRANT SELECT ON public.chat_traces TO authenticated;
GRANT ALL ON public.chat_traces TO service_role;

ALTER TABLE public.chat_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own chat traces"
ON public.chat_traces FOR SELECT TO authenticated
USING (auth.uid() = user_id);