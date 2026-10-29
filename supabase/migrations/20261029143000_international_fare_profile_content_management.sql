-- CRUD administrativo dos perfis tarifarios internacionais.
-- Exclusoes sao logicas e reversiveis; as regras estaticas permanecem como fallback.

alter table public.international_fare_profile_settings
  add column if not exists short_code text,
  add column if not exists fields jsonb,
  add column if not exists is_custom boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references auth.users(id) on delete restrict,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete restrict;

alter table public.international_fare_profile_settings
  drop constraint if exists international_fare_profile_settings_short_code_check;
alter table public.international_fare_profile_settings
  add constraint international_fare_profile_settings_short_code_check
  check (short_code is null or char_length(btrim(short_code)) between 1 and 20);

alter table public.international_fare_profile_settings
  drop constraint if exists international_fare_profile_settings_fields_check;
alter table public.international_fare_profile_settings
  add constraint international_fare_profile_settings_fields_check
  check (
    fields is null or (
      jsonb_typeof(fields) = 'object'
      and fields - array['seat','carryOn','checked','change','refund','noShow','openTicket']::text[] = '{}'::jsonb
    )
  );

alter table public.international_fare_profile_settings
  drop constraint if exists international_fare_profile_settings_delete_state_check;
alter table public.international_fare_profile_settings
  add constraint international_fare_profile_settings_delete_state_check
  check (
    (is_active and deleted_at is null and deleted_by is null)
    or (not is_active and deleted_at is not null and deleted_by is not null)
  );

grant update (
  profile_name,short_code,category,rule_updated_on,fields,is_custom,is_active,
  deleted_at,deleted_by,updated_by
) on public.international_fare_profile_settings to authenticated;

create index if not exists international_fare_profile_settings_active_idx
  on public.international_fare_profile_settings(organization_id,airline_code,is_active,category);
