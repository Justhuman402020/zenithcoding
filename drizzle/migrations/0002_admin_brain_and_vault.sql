CREATE TABLE IF NOT EXISTS public.admin_brain (
  id text PRIMARY KEY DEFAULT 'global',
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT ALL ON public.admin_brain TO service_role;
ALTER TABLE public.admin_brain ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'key',
  base_url text,
  account_id text,
  key_encrypted text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_credentials TO service_role;
ALTER TABLE public.admin_credentials ENABLE ROW LEVEL SECURITY;