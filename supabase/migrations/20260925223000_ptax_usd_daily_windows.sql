-- As novas consultas e a leitura da interface usam apenas USD. Registros
-- históricos de outras moedas são preservados para evitar perda de dados.

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

alter table public.exchange_rate_runs enable row level security;
revoke all on public.exchange_rate_runs from anon,authenticated;

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
security definer
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

do $block$
begin
  if exists (select 1 from cron.job where jobname = 'update-ptax-weekdays') then
    perform cron.unschedule('update-ptax-weekdays');
  end if;
  if exists (select 1 from cron.job where jobname = 'update-ptax-weekdays-retry') then
    perform cron.unschedule('update-ptax-weekdays-retry');
  end if;
  if exists (select 1 from cron.job where jobname = 'update-ptax-midnight') then
    perform cron.unschedule('update-ptax-midnight');
  end if;
  if exists (select 1 from cron.job where jobname = 'update-ptax-opening') then
    perform cron.unschedule('update-ptax-opening');
  end if;
end
$block$;

select cron.schedule(
  'update-ptax-midnight',
  '5 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ptax_project_url') || '/functions/v1/update-ptax',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-ptax-update-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'ptax_update_secret')
    ),
    body := '{"slot":"midnight"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

select cron.schedule(
  'update-ptax-opening',
  '0 10 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ptax_project_url') || '/functions/v1/update-ptax',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-ptax-update-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'ptax_update_secret')
    ),
    body := '{"slot":"opening"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
