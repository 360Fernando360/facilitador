alter table public.organization_members
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid;

-- A identidade e o vínculo são preservados até que exista um procedimento
-- explícito de exclusão definitiva. Excluir no Auth não contorna essa regra.
alter table public.organization_members
  drop constraint if exists organization_members_user_id_fkey;
alter table public.organization_members
  add constraint organization_members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

alter table public.organization_members
  drop constraint if exists organization_members_deactivated_by_fkey;
alter table public.organization_members
  add constraint organization_members_deactivated_by_fkey
  foreign key (deactivated_by) references auth.users(id) on delete set null;

alter table public.organization_members
  drop constraint if exists organization_members_active_state_check;
alter table public.organization_members
  add constraint organization_members_active_state_check check (
    (is_active and deactivated_at is null and deactivated_by is null)
    or
    (not is_active and deactivated_at is not null)
  );

-- Usuários existentes permanecem ativos. A normalização também torna a
-- migration segura caso uma execução anterior tenha criado apenas as colunas.
update public.organization_members
set deactivated_at = null,
    deactivated_by = null
where is_active;

-- Credenciais pessoais impedem a remoção do vínculo e, por consequência,
-- também impedem que uma exclusão no Auth as apague por cascata intermediária.
alter table public.private_credentials
  drop constraint if exists private_credentials_organization_id_user_id_fkey;
alter table public.private_credentials
  add constraint private_credentials_organization_id_user_id_fkey
  foreign key (organization_id,user_id)
  references public.organization_members(organization_id,user_id)
  on delete restrict;

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
    raise exception 'Usuário sem organização ativa';
  end if;

  select last_seen_at into previous_seen_at
  from public.user_activity
  where user_id = actor_id;

  if previous_seen_at is not null then
    elapsed_seconds := greatest(0,least(300,extract(epoch from (now()-previous_seen_at))::integer));
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

drop policy if exists "authenticated members can read exchange rates" on public.exchange_rates;
create policy "authenticated members can read exchange rates"
on public.exchange_rates for select to authenticated
using (exists (
  select 1 from public.organization_members
  where user_id = (select auth.uid())
    and is_active
));

-- A linha da organização serializa alterações concorrentes. Assim, duas
-- desativações simultâneas não conseguem remover o último administrador ativo.
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

  -- Requisições repetidas são idempotentes e preservam quem/quando desativou.
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
