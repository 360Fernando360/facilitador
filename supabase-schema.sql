-- Execute este arquivo no SQL Editor do Supabase antes de usar o sistema.
-- A criação de empresas e vínculos deve ser feita por um administrador no Dashboard/SQL Editor.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id),
  unique (user_id)
);

create index if not exists organization_members_user_id_idx on public.organization_members(user_id);

-- Toda emissão futura deve ter organization_id. A interface atual não grava emissões,
-- mas esta tabela já nasce isolada por empresa.
create table if not exists public.emissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists emissions_organization_id_idx on public.emissions(organization_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.emissions enable row level security;

-- A função evita recursão entre as políticas de organizações e membros.
create or replace function public.current_organization_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select organization_id
  from public.organization_members
  where user_id = (select auth.uid())
$$;

revoke all on function public.current_organization_ids() from public;
grant execute on function public.current_organization_ids() to authenticated;

drop policy if exists "members can read their organization" on public.organizations;
create policy "members can read their organization"
on public.organizations for select to authenticated
using (id in (select public.current_organization_ids()));

drop policy if exists "users can read their membership" on public.organization_members;
create policy "users can read their membership"
on public.organization_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "members can read their emissions" on public.emissions;
create policy "members can read their emissions"
on public.emissions for select to authenticated
using (organization_id in (select public.current_organization_ids()));

drop policy if exists "members can create emissions for their organization" on public.emissions;
create policy "members can create emissions for their organization"
on public.emissions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
);

-- Exemplo de provisionamento (crie o usuário em Authentication > Users primeiro):
-- insert into public.organizations (name,slug) values ('Empresa Exemplo','empresa-exemplo');
-- insert into public.organization_members (organization_id,user_id,role)
-- values ('ID_DA_EMPRESA','ID_DO_USUARIO_AUTH','admin');
