-- A sessao do Supabase e a autoridade do prazo. Renovar o access token mantem
-- o mesmo session_id e, portanto, nao altera a meia-noite calculada aqui.
create or replace function public.daily_session_deadline_for(
  target_user_id uuid,
  target_session_id uuid
)
returns timestamptz
language sql
security definer
set search_path = ''
stable
as $$
  select (
    ((session.created_at at time zone 'America/Sao_Paulo')::date + 1)::timestamp
    at time zone 'America/Sao_Paulo'
  )
  from auth.sessions as session
  where session.id = target_session_id
    and session.user_id = target_user_id
$$;

revoke all on function public.daily_session_deadline_for(uuid,uuid) from public,anon,authenticated;
grant execute on function public.daily_session_deadline_for(uuid,uuid) to service_role;

create or replace function public.get_daily_session_deadline()
returns timestamptz
language sql
security definer
set search_path = ''
stable
as $$
  select public.daily_session_deadline_for((select auth.uid()),session.id)
  from auth.sessions as session
  where session.user_id = (select auth.uid())
    and session.id::text = coalesce((select auth.jwt()->>'session_id'),'')
$$;

revoke all on function public.get_daily_session_deadline() from public,anon;
grant execute on function public.get_daily_session_deadline() to authenticated;

create or replace function public.is_daily_session_valid()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(now() < public.get_daily_session_deadline(),false)
$$;

revoke all on function public.is_daily_session_valid() from public,anon;
grant execute on function public.is_daily_session_valid() to authenticated;

create or replace function public.is_daily_session_valid_for(
  target_user_id uuid,
  target_session_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    now() < public.daily_session_deadline_for(target_user_id,target_session_id),
    false
  )
$$;

revoke all on function public.is_daily_session_valid_for(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_daily_session_valid_for(uuid,uuid) to service_role;

create or replace function public.current_organization_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select organization_id
  from public.organization_members
  where public.is_daily_session_valid()
    and user_id = (select auth.uid())
    and is_active
$$;

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.is_daily_session_valid() and exists (
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
  select public.is_daily_session_valid() and exists (
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
  if not public.is_daily_session_valid() then
    raise exception 'Sessao diaria expirada';
  end if;

  select organization_id into actor_organization_id
  from public.organization_members
  where user_id = actor_id
    and is_active;

  if actor_id is null or actor_organization_id is null then
    raise exception 'Usuario sem organizacao vinculada';
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

drop policy if exists "users can read their membership" on public.organization_members;
create policy "users can read their membership"
on public.organization_members for select to authenticated
using (
  user_id = (select auth.uid())
  and public.is_daily_session_valid()
);
drop policy if exists "authenticated members can read exchange rates" on public.exchange_rates;
create policy "authenticated members can read exchange rates"
on public.exchange_rates for select to authenticated
using (
  public.is_daily_session_valid()
  and exists (
    select 1 from public.organization_members
    where user_id = (select auth.uid())
      and is_active
  )
);

