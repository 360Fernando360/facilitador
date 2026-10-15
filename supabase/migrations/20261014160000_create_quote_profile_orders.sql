-- Ordem de exibicao dos perfis tarifarios por empresa e companhia.
-- O conteudo dos perfis permanece no arquivo estatico existente.

create table if not exists public.quote_profile_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  airline_code text not null check (
    char_length(airline_code) between 2 and 12
    and airline_code = upper(airline_code)
    and airline_code ~ '^[A-Z0-9]+$'
  ),
  profile_keys text[] not null default '{}'::text[] check (cardinality(profile_keys) <= 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,airline_code)
);

alter table public.quote_profile_orders enable row level security;

revoke all on public.quote_profile_orders from anon,authenticated;
grant select,insert on public.quote_profile_orders to authenticated;
grant update (profile_keys,updated_by) on public.quote_profile_orders to authenticated;

create policy "members can read quote profile order"
on public.quote_profile_orders for select to authenticated
using (organization_id in (select public.current_organization_ids()));

create policy "managers can create quote profile order"
on public.quote_profile_orders for insert to authenticated
with check (
  organization_id in (select public.current_organization_ids())
  and public.can_manage_organization(organization_id)
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy "managers can update quote profile order"
on public.quote_profile_orders for update to authenticated
using (public.can_manage_organization(organization_id))
with check (
  organization_id in (select public.current_organization_ids())
  and public.can_manage_organization(organization_id)
  and updated_by = (select auth.uid())
);

create or replace function public.set_quote_profile_order_updated_at()
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

revoke all on function public.set_quote_profile_order_updated_at() from public,anon,authenticated;

create trigger set_quote_profile_order_updated_at
before update on public.quote_profile_orders
for each row execute function public.set_quote_profile_order_updated_at();
