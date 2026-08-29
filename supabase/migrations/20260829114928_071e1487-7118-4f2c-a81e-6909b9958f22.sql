CREATE TABLE public.ai_model_settings (
  id text PRIMARY KEY DEFAULT 'global',
  provider text NOT NULL DEFAULT 'groq',
  model text NOT NULL DEFAULT 'openai/gpt-oss-120b',
  auto_fallback boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.ai_model_settings TO authenticated;
GRANT ALL ON public.ai_model_settings TO service_role;
ALTER TABLE public.ai_model_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read model settings" ON public.ai_model_settings FOR SELECT TO authenticated USING (true);

CREATE TABLE public.ai_model_status (
  provider text NOT NULL,
  model text NOT NULL,
  last_status text,
  last_error text,
  last_used_at timestamptz,
  requests_used integer NOT NULL DEFAULT 0,
  remaining_requests integer,
  limit_requests integer,
  remaining_tokens bigint,
  limit_tokens bigint,
  reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);
GRANT SELECT ON public.ai_model_status TO authenticated;
GRANT ALL ON public.ai_model_status TO service_role;
ALTER TABLE public.ai_model_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read model status" ON public.ai_model_status FOR SELECT TO authenticated USING (true);

INSERT INTO public.ai_model_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;