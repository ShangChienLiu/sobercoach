-- SoberCoach AI schema v1
-- Seven tables, all keyed by user_id, all protected by row-level security.
-- The model never writes here directly: Edge Function code does, via tools.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  timezone       text not null default 'America/Los_Angeles',
  rollover_hour  smallint not null default 4 check (rollover_hour between 0 and 12),
  goal_type      text not null default 'moderation' check (goal_type in ('moderation','abstinence')),
  weekly_limit   numeric(5,2) not null default 14,
  quiet_start    smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end      smallint not null default 9  check (quiet_end between 0 and 23),
  is_test        boolean not null default false,
  age_confirmed  boolean not null default false,
  apns_token     text,
  last_opened_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- drink_entries
-- ---------------------------------------------------------------------------
create table if not exists public.drink_entries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  occurred_at         timestamptz not null default now(),
  service_date        date not null,
  beverage            text not null default 'drink',
  count               numeric(5,2) not null default 1 check (count >= 0),
  volume_ml           numeric(7,1),
  abv                 numeric(5,2) check (abv is null or (abv >= 0 and abv <= 100)),
  std_drinks_exact    numeric(6,2),
  std_drinks_nominal  numeric(6,2) not null,
  status              text not null default 'active' check (status in ('active','undone','confirmed_dry')),
  version             integer not null default 1,
  previous_snapshot   jsonb,
  source              text not null default 'chat' check (source in ('chat','quick_log','regex','correction','system')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists drink_entries_user_service_idx on public.drink_entries (user_id, service_date desc);
create index if not exists drink_entries_user_occurred_idx on public.drink_entries (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  starts_at       timestamptz not null,
  timezone        text not null,
  source_message  text,
  status          text not null default 'active' check (status in ('active','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists events_user_starts_idx on public.events (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- consents (one row per reminder category)
-- ---------------------------------------------------------------------------
create table if not exists public.consents (
  user_id     uuid not null references auth.users(id) on delete cascade,
  category    text not null check (category in ('event_prep','morning_after','missed_log')),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, category)
);

-- ---------------------------------------------------------------------------
-- coach_memory
-- ---------------------------------------------------------------------------
create table if not exists public.coach_memory (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  summary     text not null default '',
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- messages (live cost, routing and safety ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  role           text not null check (role in ('user','assistant','system')),
  content        text not null,
  tier           text check (tier in ('tier0_safety','tier0_fastpath','small','strong','fallback_fixed')),
  model          text,
  route_reason   text,
  risk_flag      boolean not null default false,
  tool_calls     jsonb,
  tokens_in      integer not null default 0,
  tokens_cached  integer not null default 0,
  tokens_out     integer not null default 0,
  cost_usd       numeric(10,6) not null default 0,
  latency_ms     integer,
  created_at     timestamptz not null default now()
);
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reminder_log (every push has a stored reason, dedupe key and outcome)
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  idempotency_key  text not null unique,
  trigger          text not null check (trigger in ('event_prep','morning_after','missed_log')),
  event_id         uuid references public.events(id) on delete cascade,
  why_now          text not null,
  body             text,
  scheduled_for    timestamptz not null,
  sent_at          timestamptz,
  status           text not null default 'pending'
                   check (status in ('pending','sent','blocked','failed','stale')),
  block_reason     text,
  gate_trace       jsonb,
  opened_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists reminder_log_user_sent_idx on public.reminder_log (user_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: every table, every operation, user_id = auth.uid()
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','drink_entries','events','consents','coach_memory','messages','reminder_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t, t);
  end loop;
end $$;

-- Clients may read their own ledger and reminders but never write them.
drop policy if exists messages_owner on public.messages;
create policy messages_owner_read on public.messages for select to authenticated using (user_id = auth.uid());
drop policy if exists reminder_log_owner on public.reminder_log;
create policy reminder_log_owner_read on public.reminder_log for select to authenticated using (user_id = auth.uid());
create policy reminder_log_owner_open on public.reminder_log for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Service-day helpers
-- ---------------------------------------------------------------------------
-- service_date = (occurred_at AT TIME ZONE tz - rollover_hour)::date
create or replace function public.service_date_for(ts timestamptz, tz text, rollover smallint)
returns date language sql immutable as $$
  select ((ts at time zone tz) - make_interval(hours => rollover))::date
$$;

-- Fill service_date and nominal drinks on insert/update when the caller left them out.
create or replace function public.drink_entries_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tz text := 'America/Los_Angeles';
  v_roll smallint := 4;
begin
  -- security definer so the lookup works even when RLS hides the profile row;
  -- the row itself is still gated by the caller's RLS policy on drink_entries.
  select timezone, rollover_hour into v_tz, v_roll from public.profiles where user_id = new.user_id;
  if v_tz is null then v_tz := 'America/Los_Angeles'; end if;
  if v_roll is null then v_roll := 4; end if;
  new.service_date := public.service_date_for(new.occurred_at, v_tz, v_roll);
  if new.volume_ml is not null and new.abv is not null then
    -- U.S. standard drink = 14 g pure alcohol = 0.6 fl oz pure alcohol
    new.std_drinks_exact := round(((new.volume_ml / 29.5735) * (new.abv / 100.0) / 0.6) * new.count, 2);
  else
    new.std_drinks_exact := null;
  end if;
  if new.std_drinks_nominal is null or tg_op = 'UPDATE' then
    new.std_drinks_nominal := round(new.count * 1.0, 2);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists drink_entries_fill_trg on public.drink_entries;
create trigger drink_entries_fill_trg
before insert or update of occurred_at, count, volume_ml, abv on public.drink_entries
for each row execute function public.drink_entries_fill();

-- ---------------------------------------------------------------------------
-- Totals. A service day with no active rows is absent here, which the
-- functions report as NO_DATA, never zero.
-- ---------------------------------------------------------------------------
create or replace view public.daily_totals
with (security_invoker = true) as
select
  user_id,
  service_date,
  sum(count)                                              as drinks_count,
  sum(coalesce(std_drinks_exact, std_drinks_nominal))     as std_drinks,
  bool_or(std_drinks_exact is null and status = 'active') as has_nominal,
  bool_or(status = 'confirmed_dry')                       as confirmed_dry,
  count(*) filter (where status = 'active')               as active_entries
from public.drink_entries
where status in ('active','confirmed_dry')
group by user_id, service_date;

-- Rolling 7 service days ending at the given anchor date.
create or replace function public.weekly_total(p_user uuid, p_anchor date)
returns table (std_drinks numeric, has_nominal boolean, days_with_data integer)
language sql stable security invoker as $$
  select
    coalesce(sum(std_drinks), 0),
    coalesce(bool_or(has_nominal), false),
    count(*)::integer
  from public.daily_totals
  where user_id = p_user
    and service_date between p_anchor - 6 and p_anchor
$$;

-- ---------------------------------------------------------------------------
-- Defaults on signup: profile, consents, memory
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.consents (user_id, category)
    values (new.id,'event_prep'), (new.id,'morning_after'), (new.id,'missed_log')
    on conflict do nothing;
  insert into public.coach_memory (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Account deletion: one call cascades across all seven tables.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
