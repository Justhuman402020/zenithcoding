CREATE TABLE public.model_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  chat_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  base_url text,
  section text NOT NULL DEFAULT 'chat',
  key_index integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  first_token_ms integer,
  total_ms integer,
  status text NOT NULL DEFAULT 'ok',
  error_short text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_call_log_user_created_idx ON public.model_call_log (user_id, created_at DESC);
GRANT SELECT ON public.model_call_log TO authenticated;
GRANT ALL ON public.model_call_log TO service_role;
ALTER TABLE public.model_call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own model calls" ON public.model_call_log FOR SELECT TO authenticated USING (auth.uid() = user_id AND public.workspace_session_allowed());

CREATE OR REPLACE FUNCTION public.prune_model_call_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF random() < 0.05 THEN
    DELETE FROM public.model_call_log WHERE created_at < now() - interval '30 days';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_call_log_prune AFTER INSERT ON public.model_call_log FOR EACH ROW EXECUTE FUNCTION public.prune_model_call_log();