
-- ================= PLANS / SUBSCRIPTIONS / CREDIT LEDGER =================
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  stripe_price_id text,
  monthly_credits integer NOT NULL DEFAULT 0,
  price_cents integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans are public" ON public.plans FOR SELECT USING (active = true);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'inactive',
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON public.credit_ledger(user_id, created_at DESC);
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ledger" ON public.credit_ledger FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_credit_balance(_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(delta), 0)::int FROM public.credit_ledger WHERE user_id = _user
$$;

-- ================= WORKSPACES =================
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  personal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_ws uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = _ws AND user_id = _user)
$$;

CREATE POLICY "workspace visible to members" ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "members visible to members" ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Personal workspace for each new user
CREATE OR REPLACE FUNCTION public.ensure_personal_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_id uuid;
BEGIN
  INSERT INTO public.workspaces (name, slug, owner_user_id, personal)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)) || '''s workspace',
          'ws-' || substr(NEW.id::text, 1, 8),
          NEW.id, true)
  RETURNING id INTO ws_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (ws_id, NEW.id, 'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_workspace
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.ensure_personal_workspace();

-- Backfill for existing users
INSERT INTO public.workspaces (name, slug, owner_user_id, personal)
SELECT COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)) || '''s workspace',
       'ws-' || substr(u.id::text, 1, 8), u.id, true
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.owner_user_id = u.id AND w.personal);
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_user_id, 'owner'
FROM public.workspaces w
WHERE w.personal AND NOT EXISTS (
  SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id = w.owner_user_id
);

-- ================= PROJECTS EXTENSIONS =================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS remix_of_project_id uuid REFERENCES public.projects(id);

UPDATE public.projects p SET workspace_id = w.id
FROM public.workspaces w
WHERE p.workspace_id IS NULL AND w.owner_user_id = p.user_id AND w.personal;

-- ================= TRANSFERS =================
CREATE TABLE public.project_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id)
);
CREATE INDEX project_transfers_token_idx ON public.project_transfers(token);
GRANT SELECT, INSERT, UPDATE ON public.project_transfers TO authenticated;
GRANT ALL ON public.project_transfers TO service_role;
ALTER TABLE public.project_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sender sees own transfers" ON public.project_transfers FOR SELECT
  USING (auth.uid() = from_user_id);
CREATE POLICY "sender can create transfers on own projects" ON public.project_transfers FOR INSERT
  WITH CHECK (auth.uid() = from_user_id AND EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "sender can cancel" ON public.project_transfers FOR UPDATE
  USING (auth.uid() = from_user_id) WITH CHECK (auth.uid() = from_user_id);

-- ================= TEMPLATES =================
CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  thumbnail_url text,
  files jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.templates TO anon, authenticated;
GRANT ALL ON public.templates TO service_role;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates are public" ON public.templates FOR SELECT USING (true);

-- ================= SEEDS =================
INSERT INTO public.plans (slug, name, monthly_credits, price_cents) VALUES
  ('free', 'Free', 30, 0),
  ('pro', 'Pro', 100, 2000),
  ('business', 'Business', 500, 5000),
  ('enterprise', 'Enterprise', 10000, 50000)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.templates (slug, name, description, category, thumbnail_url, featured, files) VALUES
  ('landing', 'Landing Page', 'Clean marketing landing page with hero, features, and CTA.', 'Marketing', null, true,
   '{"index.html": "<!doctype html><html><head><meta charset=\"utf-8\"><title>Launch</title><link rel=\"stylesheet\" href=\"style.css\"></head><body><header><h1>Launch faster</h1><p>Ship your idea today.</p><a class=\"cta\" href=\"#\">Get started</a></header><section class=\"features\"><div><h3>Fast</h3><p>Zero-config setup.</p></div><div><h3>Modern</h3><p>Built on web standards.</p></div><div><h3>Yours</h3><p>Fully customizable.</p></div></section></body></html>", "style.css": "*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;color:#111;background:#fff}header{padding:6rem 2rem;text-align:center;background:linear-gradient(135deg,#f5f7ff,#e9eeff)}h1{font-size:3rem;margin-bottom:1rem}.cta{display:inline-block;margin-top:2rem;padding:.9rem 1.6rem;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none}.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;padding:3rem 2rem}.features div{padding:1.5rem;border:1px solid #eee;border-radius:12px}"}'::jsonb),
  ('portfolio', 'Portfolio', 'Personal portfolio with projects grid and about section.', 'Personal', null, true,
   '{"index.html": "<!doctype html><html><head><meta charset=\"utf-8\"><title>My work</title><link rel=\"stylesheet\" href=\"style.css\"></head><body><nav><b>Me</b><a href=\"#work\">Work</a><a href=\"#about\">About</a></nav><section id=\"work\"><h2>Selected work</h2><div class=\"grid\"><article>Project A</article><article>Project B</article><article>Project C</article></div></section><section id=\"about\"><h2>About</h2><p>I build things for the web.</p></section></body></html>", "style.css": "body{font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:2rem;color:#222}nav{display:flex;gap:1rem;align-items:center;padding-bottom:2rem;border-bottom:1px solid #eee}nav a{margin-left:auto;text-decoration:none;color:#444}nav a+a{margin-left:1rem}section{padding:3rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}.grid article{padding:2rem;background:#fafafa;border-radius:12px}"}'::jsonb),
  ('blog', 'Blog', 'Minimalist blog homepage with post list.', 'Content', null, true,
   '{"index.html": "<!doctype html><html><head><meta charset=\"utf-8\"><title>Blog</title><link rel=\"stylesheet\" href=\"style.css\"></head><body><header><h1>The Blog</h1><p>Thoughts, essays, notes.</p></header><main><article><h2><a href=\"#\">Hello, world</a></h2><time>Today</time><p>First post. More coming soon.</p></article><article><h2><a href=\"#\">Why build in public</a></h2><time>Yesterday</time><p>Sharing the process helps you learn.</p></article></main></body></html>", "style.css": "body{font-family:system-ui,sans-serif;max-width:680px;margin:0 auto;padding:3rem 1.5rem;color:#111;line-height:1.6}header{margin-bottom:3rem}h1{font-size:2.4rem}article{margin-bottom:2.5rem}article h2 a{color:#111;text-decoration:none}time{color:#888;font-size:.85rem}"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
