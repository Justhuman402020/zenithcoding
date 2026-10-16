create table if not exists public.ai_gateway_settings (
  id text primary key default 'global',
  url text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

grant select, insert, update on public.ai_gateway_settings to authenticated;
grant all on public.ai_gateway_settings to service_role;

alter table public.ai_gateway_settings enable row level security;

create policy "Admins can read gateway settings"
  on public.ai_gateway_settings for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can save gateway settings"
  on public.ai_gateway_settings for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update gateway settings"
  on public.ai_gateway_settings for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));