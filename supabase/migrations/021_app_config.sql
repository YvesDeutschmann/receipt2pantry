-- Lightweight key/value config readable by the mobile app (anon) for dev API URL sync (e.g. ngrok).
-- Writes use the service role from local tooling only.

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config for select using (true);

-- No INSERT/UPDATE policies for anon/authenticated; service role bypasses RLS for upserts from dev scripts.

-- app_config: SELECT by anon (mobile dev API URL sync) and authenticated (RLS: public read);
-- full access by service_role (ngrok script upserts)
GRANT SELECT ON public.app_config TO anon;
GRANT SELECT ON public.app_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_config TO service_role;

insert into public.app_config (key, value)
values ('dev_api_base_url', '')
on conflict (key) do nothing;
