-- Textos complementares por empresa e companhia para o montador de cotacoes.
-- Limites: titulo 120 caracteres; conteudo 5000 caracteres; codigo 12 caracteres.

create table if not exists public.quote_complementary_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  airline_code text not null check (
    char_length(airline_code) between 2 and 12
    and airline_code = upper(airline_code)
    and airline_code ~ '^[A-Z0-9]+$'
  ),
  title text not null check (
    char_length(btrim(title)) between 1 and 120
    and title = btrim(title)
  ),
  content text not null check (
    char_length(btrim(content)) between 1 and 5000
    and content = btrim(content)
  ),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_complementary_texts_org_airline_idx
  on public.quote_complementary_texts(organization_id,airline_code,is_active,title);

alter table public.quote_complementary_texts enable row level security;

revoke all on public.quote_complementary_texts from anon,authenticated;
grant select,insert on public.quote_complementary_texts to authenticated;
grant update (airline_code,title,content,is_active,updated_by)
  on public.quote_complementary_texts to authenticated;

drop policy if exists "members can read quote complementary texts" on public.quote_complementary_texts;
create policy "members can read quote complementary texts"
on public.quote_complementary_texts for select to authenticated
using (
  organization_id in (select public.current_organization_ids())
  and (is_active or public.can_manage_organization(organization_id))
);

drop policy if exists "managers can create quote complementary texts" on public.quote_complementary_texts;
create policy "managers can create quote complementary texts"
on public.quote_complementary_texts for insert to authenticated
with check (
  organization_id in (select public.current_organization_ids())
  and public.can_manage_organization(organization_id)
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists "managers can update quote complementary texts" on public.quote_complementary_texts;
create policy "managers can update quote complementary texts"
on public.quote_complementary_texts for update to authenticated
using (
  public.can_manage_organization(organization_id)
)
with check (
  organization_id in (select public.current_organization_ids())
  and public.can_manage_organization(organization_id)
  and updated_by = (select auth.uid())
);

create or replace function public.set_quote_complementary_text_updated_at()
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

revoke all on function public.set_quote_complementary_text_updated_at() from public,anon,authenticated;

drop trigger if exists set_quote_complementary_text_updated_at on public.quote_complementary_texts;
create trigger set_quote_complementary_text_updated_at
before update on public.quote_complementary_texts
for each row execute function public.set_quote_complementary_text_updated_at();

