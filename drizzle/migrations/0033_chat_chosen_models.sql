CREATE TABLE public.chat_chosen_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('ollama','openrouter')),
  key_ref text NOT NULL,
  key_label text NOT NULL DEFAULT '',
  model text NOT NULL,
  last_status text NOT NULL DEFAULT 'good',
  tested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, key_ref, model)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_chosen_models TO authenticated;
GRANT ALL ON public.chat_chosen_models TO service_role;
ALTER TABLE public.chat_chosen_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages chosen models" ON public.chat_chosen_models FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.workspace_session_allowed())
  WITH CHECK (auth.uid() = user_id AND public.workspace_session_allowed());
ALTER TABLE public.assistant_chats ADD COLUMN chosen_model_id uuid REFERENCES public.chat_chosen_models(id) ON DELETE SET NULL;