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
  user_id uuid not null references auth.users(id) on delete restrict,
  full_name text,
  email text,
  role text not null default 'member' check (role in ('admin','manager','member')),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id),
  unique (user_id),
  constraint organization_members_active_state_check check (
    (is_active and deactivated_at is null and deactivated_by is null)
    or
    (not is_active and deactivated_at is not null)
  )
);

-- Compatibilidade para projetos que executaram uma versão anterior deste arquivo.
alter table public.organization_members add column if not exists full_name text;
alter table public.organization_members add column if not exists email text;
alter table public.organization_members add column if not exists is_active boolean not null default true;
alter table public.organization_members add column if not exists deactivated_at timestamptz;
alter table public.organization_members add column if not exists deactivated_by uuid;
alter table public.organization_members drop constraint if exists organization_members_user_id_fkey;
alter table public.organization_members add constraint organization_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete restrict;
alter table public.organization_members drop constraint if exists organization_members_deactivated_by_fkey;
alter table public.organization_members add constraint organization_members_deactivated_by_fkey foreign key (deactivated_by) references auth.users(id) on delete set null;
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check check (role in ('admin','manager','member'));
alter table public.organization_members drop constraint if exists organization_members_active_state_check;
alter table public.organization_members add constraint organization_members_active_state_check check (
  (is_active and deactivated_at is null and deactivated_by is null)
  or
  (not is_active and deactivated_at is not null)
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

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  message text not null,
  kind text not null default 'notice' check (kind in ('notice','reminder')),
  event_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists announcements_organization_id_idx on public.announcements(organization_id);
create index if not exists announcements_event_date_idx on public.announcements(event_date);

create table if not exists public.vacations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_name text not null,
  start_date date not null,
  end_date date not null,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists vacations_organization_id_idx on public.vacations(organization_id);
create index if not exists vacations_dates_idx on public.vacations(start_date,end_date);

-- Presença atual e consolidação diária para o painel administrativo.
-- Não são armazenados conteúdos digitados ou dados das solicitações.
create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_page text not null default 'home',
  session_started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists user_activity_organization_idx on public.user_activity(organization_id,last_seen_at desc);

create table if not exists public.user_daily_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  access_count integer not null default 0 check (access_count >= 0),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  last_seen_at timestamptz not null default now(),
  primary key (organization_id,user_id,usage_date)
);

create index if not exists user_daily_usage_date_idx on public.user_daily_usage(organization_id,usage_date desc);

-- Histórico central de cotações oficiais. Este dado é compartilhado por todas as
-- empresas; nenhum dado operacional das organizações é misturado nesta tabela.
create table if not exists public.exchange_rates (
  id bigint generated by default as identity primary key,
  currency text not null check (currency = 'USD'),
  currency_name text not null,
  rate_sell numeric(18,8) not null check (rate_sell > 0),
  reference_date date not null,
  fetched_at timestamptz not null default now(),
  source text not null default 'Banco Central do Brasil - PTAX',
  unique (currency,reference_date)
);

-- Instalações anteriores podem conter o histórico de EUR/GBP/CAD. Esses
-- registros são preservados; a função de leitura abaixo expõe somente USD.

create index if not exists exchange_rates_latest_idx on public.exchange_rates(currency,reference_date desc);

-- Controle das duas janelas diárias da PTAX. A chave primária impede que a
-- abertura do sistema provoque consultas repetidas durante o expediente.
create table if not exists public.exchange_rate_runs (
  run_date date not null,
  slot text not null check (slot in ('midnight','opening')),
  status text not null check (status in ('running','success','failed')),
  trigger text not null check (trigger in ('schedule','startup')),
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  primary key (run_date,slot)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.emissions enable row level security;
alter table public.announcements enable row level security;
alter table public.vacations enable row level security;
alter table public.user_activity enable row level security;
alter table public.user_daily_usage enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.exchange_rate_runs enable row level security;

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
    and is_active
$$;

revoke all on function public.current_organization_ids() from public;
grant execute on function public.current_organization_ids() to authenticated;

-- Permite verificar privilégios sem criar recursão nas políticas de membros.
create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = (select auth.uid())
      and organization_id = target_organization_id
      and role = 'admin'
      and is_active
  )
$$;

revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_admin(uuid) to authenticated;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = (select auth.uid())
      and organization_id = target_organization_id
      and role in ('admin','manager')
      and is_active
  )
$$;

revoke all on function public.can_manage_organization(uuid) from public;
grant execute on function public.can_manage_organization(uuid) to authenticated;

-- Atualiza a presença e soma somente intervalos curtos entre sinais do navegador.
-- Pausas superiores a cinco minutos não são contabilizadas como tempo ativo.
create or replace function public.track_user_activity(page_name text, new_session boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_organization_id uuid;
  previous_seen_at timestamptz;
  elapsed_seconds integer := 0;
  safe_page_name text := left(coalesce(nullif(btrim(page_name),''),'home'),50);
begin
  select organization_id into actor_organization_id
  from public.organization_members
  where user_id = actor_id
    and is_active;

  if actor_id is null or actor_organization_id is null then
    raise exception 'Usuário sem organização vinculada';
  end if;

  select last_seen_at into previous_seen_at
  from public.user_activity
  where user_id = actor_id
  for update;

  if not new_session and previous_seen_at is not null and now() - previous_seen_at <= interval '5 minutes' then
    elapsed_seconds := greatest(0,least(300,floor(extract(epoch from (now() - previous_seen_at)))::integer));
  end if;

  insert into public.user_activity (user_id,organization_id,current_page,session_started_at,last_seen_at)
  values (actor_id,actor_organization_id,safe_page_name,now(),now())
  on conflict (user_id) do update set
    organization_id = excluded.organization_id,
    current_page = excluded.current_page,
    session_started_at = case when new_session then now() else public.user_activity.session_started_at end,
    last_seen_at = now();

  insert into public.user_daily_usage (organization_id,user_id,usage_date,access_count,active_seconds,last_seen_at)
  values (actor_organization_id,actor_id,(now() at time zone 'America/Sao_Paulo')::date,case when new_session then 1 else 0 end,elapsed_seconds,now())
  on conflict (organization_id,user_id,usage_date) do update set
    access_count = public.user_daily_usage.access_count + excluded.access_count,
    active_seconds = public.user_daily_usage.active_seconds + excluded.active_seconds,
    last_seen_at = now();
end;
$$;

revoke all on function public.track_user_activity(text,boolean) from public;
grant execute on function public.track_user_activity(text,boolean) to authenticated;

revoke all on public.user_activity from anon,authenticated;
revoke all on public.user_daily_usage from anon,authenticated;
grant select on public.user_activity to authenticated;
grant select on public.user_daily_usage to authenticated;

revoke all on public.exchange_rates from anon,authenticated;
grant select on public.exchange_rates to authenticated;
revoke all on public.exchange_rate_runs from anon,authenticated;

-- Camada única para a tela inicial e a Calculadora de Reemissão. Retorna
-- somente a PTAX USD vigente, preservando a última taxa válida salva.
create or replace function public.get_latest_exchange_rates()
returns table (
  currency text,
  currency_name text,
  rate_sell numeric,
  reference_date date,
  fetched_at timestamptz,
  source text
)
language sql
security invoker
set search_path = ''
stable
as $$
  select distinct on (rates.currency)
    rates.currency,
    rates.currency_name,
    rates.rate_sell,
    rates.reference_date,
    rates.fetched_at,
    rates.source
  from public.exchange_rates as rates
  where rates.currency = 'USD'
  order by rates.currency,rates.reference_date desc,rates.fetched_at desc
$$;

revoke all on function public.get_latest_exchange_rates() from public;
grant execute on function public.get_latest_exchange_rates() to authenticated;

drop policy if exists "members can read their organization" on public.organizations;
create policy "members can read their organization"
on public.organizations for select to authenticated
using (id in (select public.current_organization_ids()));

drop policy if exists "users can read their membership" on public.organization_members;
create policy "users can read their membership"
on public.organization_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admins can read organization members" on public.organization_members;
create policy "admins can read organization members"
on public.organization_members for select to authenticated
using (public.can_manage_organization(organization_id));

drop policy if exists "admins can read user activity" on public.user_activity;
create policy "admins can read user activity"
on public.user_activity for select to authenticated
using (public.is_organization_admin(organization_id));

drop policy if exists "admins can read daily usage" on public.user_daily_usage;
create policy "admins can read daily usage"
on public.user_daily_usage for select to authenticated
using (public.is_organization_admin(organization_id));

drop policy if exists "authenticated members can read exchange rates" on public.exchange_rates;
create policy "authenticated members can read exchange rates"
on public.exchange_rates for select to authenticated
using (exists (
  select 1 from public.organization_members
  where user_id = (select auth.uid())
    and is_active
));

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

drop policy if exists "members can read announcements" on public.announcements;
create policy "members can read announcements"
on public.announcements for select to authenticated
using (organization_id in (select public.current_organization_ids()));

drop policy if exists "managers can create announcements" on public.announcements;
create policy "managers can create announcements"
on public.announcements for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_manage_organization(organization_id)
);

drop policy if exists "managers can delete announcements" on public.announcements;
create policy "managers can delete announcements"
on public.announcements for delete to authenticated
using (public.can_manage_organization(organization_id));

drop policy if exists "members can read vacations" on public.vacations;
create policy "members can read vacations"
on public.vacations for select to authenticated
using (organization_id in (select public.current_organization_ids()));

drop policy if exists "managers can create vacations" on public.vacations;
create policy "managers can create vacations"
on public.vacations for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_manage_organization(organization_id)
);

drop policy if exists "managers can delete vacations" on public.vacations;
create policy "managers can delete vacations"
on public.vacations for delete to authenticated
using (public.can_manage_organization(organization_id));

-- Exemplo de provisionamento (crie o usuário em Authentication > Users primeiro):
-- insert into public.organizations (name,slug) values ('Empresa Exemplo','empresa-exemplo');
-- insert into public.organization_members (organization_id,user_id,role)
-- values ('ID_DA_EMPRESA','ID_DO_USUARIO_AUTH','admin');

-- Cofre pessoal de credenciais. Os campos sensíveis contêm somente dados
-- cifrados pela Edge Function credential-vault; a chave nunca fica no banco.
create table if not exists public.private_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  portal_url text check (portal_url is null or char_length(portal_url) <= 2048),
  agency_ciphertext text,
  agency_nonce text,
  username_ciphertext text not null,
  username_nonce text not null,
  password_ciphertext text not null,
  password_nonce text not null,
  notes_ciphertext text,
  notes_nonce text,
  key_version smallint not null default 1 check (key_version > 0),
  sort_order bigint not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,user_id)
    references public.organization_members(organization_id,user_id)
    on delete restrict,
  check ((agency_ciphertext is null) = (agency_nonce is null)),
  check ((notes_ciphertext is null) = (notes_nonce is null))
);

create index if not exists private_credentials_owner_order_idx
  on public.private_credentials(organization_id,user_id,sort_order,id);

alter table public.private_credentials enable row level security;

create or replace function public.set_private_credentials_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists private_credentials_set_updated_at on public.private_credentials;
create trigger private_credentials_set_updated_at
before update on public.private_credentials
for each row execute function public.set_private_credentials_updated_at();

revoke all on function public.set_private_credentials_updated_at() from public,anon,authenticated;
revoke all on public.private_credentials from anon,authenticated;
grant select,insert,update,delete on public.private_credentials to service_role;

drop policy if exists "users can read only their private credentials" on public.private_credentials;
create policy "users can read only their private credentials"
on public.private_credentials for select to authenticated
using (
  user_id = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
);

drop policy if exists "users can create only their private credentials" on public.private_credentials;
create policy "users can create only their private credentials"
on public.private_credentials for insert to authenticated
with check (
  user_id = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
);

drop policy if exists "users can update only their private credentials" on public.private_credentials;
create policy "users can update only their private credentials"
on public.private_credentials for update to authenticated
using (
  user_id = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
)
with check (
  user_id = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
);

drop policy if exists "users can delete only their private credentials" on public.private_credentials;
create policy "users can delete only their private credentials"
on public.private_credentials for delete to authenticated
using (
  user_id = (select auth.uid())
  and organization_id in (select public.current_organization_ids())
);

-- Executada somente pela Edge Function com service_role. Uma chamada RPC é uma
-- única transação, evitando que uma falha deixe apenas parte da ordem atualizada.
create or replace function public.reorder_private_credentials(
  target_organization_id uuid,
  target_user_id uuid,
  credential_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_count integer := coalesce(cardinality(credential_ids),0);
  owned_count integer;
begin
  if requested_count > 500 then
    raise exception 'Ordem inválida';
  end if;

  if requested_count <> (
    select count(distinct supplied.id)
    from unnest(credential_ids) as supplied(id)
  ) then
    raise exception 'Ordem inválida';
  end if;

  select count(*) into owned_count
  from public.private_credentials
  where organization_id = target_organization_id
    and user_id = target_user_id;

  if owned_count <> requested_count or exists (
    select 1
    from unnest(credential_ids) as supplied(id)
    left join public.private_credentials as credential
      on credential.id = supplied.id
      and credential.organization_id = target_organization_id
      and credential.user_id = target_user_id
    where credential.id is null
  ) then
    raise exception 'Ordem não autorizada';
  end if;

  update public.private_credentials as credential
  set sort_order = supplied.position * 1024
  from unnest(credential_ids) with ordinality as supplied(id,position)
  where credential.id = supplied.id
    and credential.organization_id = target_organization_id
    and credential.user_id = target_user_id;
end;
$$;

revoke all on function public.reorder_private_credentials(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_private_credentials(uuid,uuid,uuid[]) to service_role;

-- Desativação preserva o vínculo, a identidade do Auth e as credenciais.
-- O bloqueio da organização serializa alterações concorrentes de administradores.
create or replace function public.set_organization_member_active(
  actor_user_id uuid,
  target_organization_id uuid,
  target_user_id uuid,
  new_active boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_role text;
  target_active boolean;
  active_admin_count integer;
begin
  perform 1
  from public.organizations
  where id = target_organization_id
  for update;

  if not exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id
      and user_id = actor_user_id
      and role = 'admin'
      and is_active
  ) then
    raise exception 'Operação não autorizada';
  end if;

  select role,is_active into target_role,target_active
  from public.organization_members
  where organization_id = target_organization_id
    and user_id = target_user_id
  for update;

  if target_role is null then
    raise exception 'Colaborador não encontrado';
  end if;

  if target_active = new_active then
    return;
  end if;

  if not new_active and actor_user_id = target_user_id then
    raise exception 'O administrador não pode desativar a própria conta';
  end if;

  if not new_active and target_active and target_role = 'admin' then
    select count(*) into active_admin_count
    from public.organization_members
    where organization_id = target_organization_id
      and role = 'admin'
      and is_active;
    if active_admin_count <= 1 then
      raise exception 'O último administrador ativo não pode ser desativado';
    end if;
  end if;

  update public.organization_members
  set is_active = new_active,
      deactivated_at = case when new_active then null else now() end,
      deactivated_by = case when new_active then null else actor_user_id end
  where organization_id = target_organization_id
    and user_id = target_user_id;
end;
$$;

revoke all on function public.set_organization_member_active(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_organization_member_active(uuid,uuid,uuid,boolean) to service_role;
