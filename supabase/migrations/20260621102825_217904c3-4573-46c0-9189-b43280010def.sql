CREATE TABLE public.github_tokens (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  github_login text,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.github_tokens TO authenticated;
GRANT ALL ON public.github_tokens TO service_role;
ALTER TABLE public.github_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own github token" ON public.github_tokens FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.github_oauth_states (
  state uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);
GRANT SELECT, INSERT, DELETE ON public.github_oauth_states TO authenticated;
GRANT ALL ON public.github_oauth_states TO service_role;
ALTER TABLE public.github_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own oauth states" ON public.github_oauth_states FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);