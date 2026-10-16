ALTER TABLE public.custom_ai_providers ADD COLUMN IF NOT EXISTS pool_position integer;
CREATE TABLE public.cloudflare_neuron_usage (
  provider_id text NOT NULL,
  day date NOT NULL,
  neurons_used numeric NOT NULL DEFAULT 0,
  exhausted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, day)
);
GRANT ALL ON public.cloudflare_neuron_usage TO service_role;
ALTER TABLE public.cloudflare_neuron_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view neuron usage" ON public.cloudflare_neuron_usage FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.cloudflare_neuron_usage TO authenticated;