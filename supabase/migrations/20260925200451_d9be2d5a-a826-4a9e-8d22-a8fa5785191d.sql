CREATE TABLE public.platform_integration_keys (
  service text NOT NULL,
  field text NOT NULL,
  value_encrypted text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, field)
);
GRANT ALL ON public.platform_integration_keys TO service_role;
ALTER TABLE public.platform_integration_keys ENABLE ROW LEVEL SECURITY;