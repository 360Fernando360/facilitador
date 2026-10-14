-- Reverte somente a expiracao diaria de sessao.
-- Este arquivo fica fora de supabase/migrations para nunca ser aplicado automaticamente.
-- Nenhuma tabela ou registro e removido.

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
using (user_id = (select auth.uid()));

drop policy if exists "authenticated members can read exchange rates" on public.exchange_rates;
create policy "authenticated members can read exchange rates"
on public.exchange_rates for select to authenticated
using (exists (
  select 1 from public.organization_members
  where user_id = (select auth.uid())
    and is_active
));

drop function if exists public.is_daily_session_valid_for(uuid,uuid);
drop function if exists public.is_daily_session_valid();
drop function if exists public.get_daily_session_deadline();
drop function if exists public.daily_session_deadline_for(uuid,uuid);
