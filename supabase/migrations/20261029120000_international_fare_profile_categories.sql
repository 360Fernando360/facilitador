-- Categorias, datas de revisao e alertas dos Branded Fares internacionais.
-- Este modulo nao altera a fonte estatica das regras nem qualquer tela nacional.

create table if not exists public.international_fare_profile_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  airline_code text not null check (
    char_length(airline_code) between 2 and 12
    and airline_code = upper(airline_code)
    and airline_code ~ '^[A-Z0-9]+$'
  ),
  profile_key text not null check (char_length(profile_key) between 1 and 500),
  profile_name text not null check (char_length(btrim(profile_name)) between 1 and 300),
  category text not null check (category in ('economy','premium','business','first')),
  rule_updated_on date,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,airline_code,profile_key)
);

create table if not exists public.international_fare_category_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  airline_code text not null check (
    char_length(airline_code) between 2 and 12
    and airline_code = upper(airline_code)
    and airline_code ~ '^[A-Z0-9]+$'
  ),
  category text not null check (category in ('economy','premium','business','first')),
  is_visible boolean not null default true,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,airline_code,category)
);

create table if not exists public.international_fare_outdated_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  airline_code text not null check (
    char_length(airline_code) between 2 and 12
    and airline_code = upper(airline_code)
    and airline_code ~ '^[A-Z0-9]+$'
  ),
  profile_key text not null check (char_length(profile_key) between 1 and 500),
  profile_name text not null check (char_length(btrim(profile_name)) between 1 and 300),
  reported_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict
);

create index if not exists international_fare_profile_settings_lookup_idx
  on public.international_fare_profile_settings(organization_id,airline_code,category);
create index if not exists international_fare_outdated_reports_open_idx
  on public.international_fare_outdated_reports(organization_id,status,created_at desc);

alter table public.international_fare_profile_settings enable row level security;
alter table public.international_fare_category_settings enable row level security;
alter table public.international_fare_outdated_reports enable row level security;

revoke all on public.international_fare_profile_settings from anon,authenticated;
revoke all on public.international_fare_category_settings from anon,authenticated;
revoke all on public.international_fare_outdated_reports from anon,authenticated;

grant select,insert on public.international_fare_profile_settings to authenticated;
grant update (profile_name,category,rule_updated_on,updated_by)
  on public.international_fare_profile_settings to authenticated;
grant select,insert on public.international_fare_category_settings to authenticated;
grant update (is_visible,updated_by)
  on public.international_fare_category_settings to authenticated;
grant insert on public.international_fare_outdated_reports to authenticated;
grant select on public.international_fare_outdated_reports to authenticated;

create policy "members can read international fare profile settings"
on public.international_fare_profile_settings for select to authenticated
using (organization_id in (select public.current_organization_ids()));

create policy "admins can create international fare profile settings"
on public.international_fare_profile_settings for insert to authenticated
with check (
  organization_id in (select public.current_organization_ids())
  and public.is_organization_admin(organization_id)
  and updated_by = (select auth.uid())
);

create policy "admins can update international fare profile settings"
on public.international_fare_profile_settings for update to authenticated
using (public.is_organization_admin(organization_id))
with check (
  organization_id in (select public.current_organization_ids())
  and public.is_organization_admin(organization_id)
  and updated_by = (select auth.uid())
);

create policy "members can read international fare category settings"
on public.international_fare_category_settings for select to authenticated
using (organization_id in (select public.current_organization_ids()));

create policy "admins can create international fare category settings"
on public.international_fare_category_settings for insert to authenticated
with check (
  organization_id in (select public.current_organization_ids())
  and public.is_organization_admin(organization_id)
  and updated_by = (select auth.uid())
);

create policy "admins can update international fare category settings"
on public.international_fare_category_settings for update to authenticated
using (public.is_organization_admin(organization_id))
with check (
  organization_id in (select public.current_organization_ids())
  and public.is_organization_admin(organization_id)
  and updated_by = (select auth.uid())
);

create policy "members can report outdated international fares"
on public.international_fare_outdated_reports for insert to authenticated
with check (
  organization_id in (select public.current_organization_ids())
  and reported_by = (select auth.uid())
  and status = 'open'
  and resolved_at is null
  and resolved_by is null
);

create policy "reporters and admins can read international fare reports"
on public.international_fare_outdated_reports for select to authenticated
using (
  organization_id in (select public.current_organization_ids())
  and (reported_by = (select auth.uid()) or public.is_organization_admin(organization_id))
);

create or replace function public.set_international_fare_setting_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_international_fare_setting_updated_at() from public,anon,authenticated;

create trigger set_international_fare_profile_setting_updated_at
before update on public.international_fare_profile_settings
for each row execute function public.set_international_fare_setting_updated_at();

create trigger set_international_fare_category_setting_updated_at
before update on public.international_fare_category_settings
for each row execute function public.set_international_fare_setting_updated_at();
