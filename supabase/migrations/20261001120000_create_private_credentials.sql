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
    on delete cascade,
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
