-- Schema assertions. Run against a database that has the migrations applied.
-- Works on local Supabase (Docker) or on plain Postgres with tests/auth_stub.sql.
\set ON_ERROR_STOP on

begin;

-- Two users
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@test')
on conflict do nothing;

-- Signup trigger created defaults
do $$ begin
  assert (select count(*) from public.profiles where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) = 2, 'profiles created on signup';
  assert (select count(*) from public.consents where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 3, 'three consent rows per user';
end $$;

update public.profiles set timezone = 'America/Los_Angeles', rollover_hour = 4, weekly_limit = 10
  where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Service-day rollover: 01:30 Sat PDT belongs to Fri
insert into public.drink_entries (id, user_id, occurred_at, service_date, beverage, count, std_drinks_nominal)
values ('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-31 08:30:00+00', '2000-01-01', 'beer', 3, 3);
do $$ begin
  assert (select service_date from public.drink_entries where id = 'e1000000-0000-0000-0000-000000000001') = date '2026-10-30', 'rollover puts 01:30 Sat on Fri';
end $$;

-- Exact standard drinks only with volume and ABV: 355 ml at 5% = 1.0 each
insert into public.drink_entries (id, user_id, occurred_at, service_date, beverage, count, volume_ml, abv, std_drinks_nominal)
values ('e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-30 20:00:00-07', '2000-01-01', 'beer', 2, 355, 5, 2);
do $$ begin
  assert (select std_drinks_exact from public.drink_entries where id = 'e1000000-0000-0000-0000-000000000002') between 1.98 and 2.02, 'two 12oz 5% beers ~ 2.0 std';
  assert (select std_drinks_exact from public.drink_entries where id = 'e1000000-0000-0000-0000-000000000001') is null, 'unknown size has null exact';
end $$;

-- Daily totals: Fri has 3 nominal + 2.0 exact, flagged has_nominal
do $$ declare r record; begin
  select * into r from public.daily_totals where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and service_date = '2026-10-30';
  assert r.std_drinks between 4.98 and 5.02, format('daily std_drinks = %s', r.std_drinks);
  assert r.has_nominal, 'has_nominal flagged';
  assert (select count(*) from public.daily_totals where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and service_date = '2026-10-29') = 0, 'a day with no rows is absent (NO_DATA), not zero';
end $$;

-- Undo sets status undone and drops out of totals
update public.drink_entries set status = 'undone' where id = 'e1000000-0000-0000-0000-000000000001';
do $$ declare r record; begin
  select * into r from public.daily_totals where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and service_date = '2026-10-30';
  assert r.std_drinks between 1.98 and 2.02, 'undone entry excluded from totals';
  assert not r.has_nominal, 'has_nominal clears when the nominal row is undone';
end $$;

-- Weekly total function
do $$ declare r record; begin
  select * into r from public.weekly_total('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-10-31');
  assert r.std_drinks between 1.98 and 2.02, 'weekly total';
  assert r.days_with_data = 1, 'one day with data';
end $$;

-- Confirmed dry day reads as data with zero drinks
insert into public.drink_entries (user_id, occurred_at, service_date, beverage, count, std_drinks_nominal, status)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-29 21:00:00-07', '2000-01-01', 'drink', 0, 0, 'confirmed_dry');
do $$ declare r record; begin
  select * into r from public.daily_totals where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and service_date = '2026-10-29';
  assert r.confirmed_dry and r.active_entries = 0, 'dry day present with no active entries';
end $$;

-- Row-level security: user B sees none of A's rows
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.drink_entries) = 0, 'B sees no entries of A';
  assert (select count(*) from public.profiles) = 1, 'B sees only own profile';
  assert (select count(*) from public.daily_totals) = 0, 'views are security_invoker';
end $$;
-- B cannot insert as A
do $$ begin
  begin
    insert into public.drink_entries (user_id, occurred_at, service_date, beverage, count, std_drinks_nominal)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), '2000-01-01', 'beer', 1, 1);
    raise exception 'RLS failed: B inserted a row for A';
  exception when insufficient_privilege or check_violation then
    null; -- expected
  end;
end $$;
-- Clients cannot write the ledger
do $$ begin
  begin
    insert into public.messages (user_id, role, content) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'user', 'x');
    raise exception 'RLS failed: client wrote to messages';
  exception when insufficient_privilege or check_violation then
    null;
  end;
end $$;
reset role;

-- Spend sum RPC and reminder claim (the ledger may hold rows from a local eval run; the window sum must start clean)
delete from public.messages;
insert into public.messages (user_id, role, content, cost_usd, created_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','assistant','x',0.0025, now()),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','assistant','y',0.0049, now() - interval '30 hours');
do $$ begin
  assert (select public.ledger_spend_since(now() - interval '24 hours')) between 0.0024 and 0.0026, 'spend sum covers only the window';
end $$;
insert into public.reminder_log (id, user_id, idempotency_key, trigger, why_now, scheduled_for)
values ('d1000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a:missed_log::2026-10-31','missed_log','test', now());
do $$ begin
  assert public.claim_reminder('d1000000-0000-0000-0000-000000000001') = true, 'first claim wins';
  assert public.claim_reminder('d1000000-0000-0000-0000-000000000001') = false, 'second claim loses';
  update public.reminder_log set claimed_at = now() - interval '11 minutes' where id = 'd1000000-0000-0000-0000-000000000001';
  assert public.claim_reminder('d1000000-0000-0000-0000-000000000001') = true, 'stale claim can be retaken';
end $$;

-- search_history: substring match per term, ranked by matches then recency, with the day's total
insert into public.messages (user_id, role, content, created_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','user','at Dan''s I will start with sparkling water', now() - interval '7 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','user','had 4 beers at Dan''s party and felt awful', now() - interval '14 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','user','what did I say about Dan', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','user','Dan again', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','user','上次在 Dan 家喝太多', now() - interval '20 days');
insert into public.drink_entries (user_id, beverage, count, std_drinks_nominal, service_date, occurred_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','beer',4,4.0,((now() - interval '14 days') at time zone 'Asia/Taipei' - interval '4 hours')::date, now() - interval '14 days');
do $$ declare r record; n integer := 0; begin
  for r in select * from public.search_messages('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['dan','party'], 'what did I say about Dan', 'Asia/Taipei', 4, 5) loop
    n := n + 1;
    if n = 1 then
      assert r.matched = 2 and r.content like 'had 4 beers%', 'best match first: ' || r.content;
      assert r.std_drinks = 4.0, 'hit carries that day''s verified total';
    end if;
    assert r.content <> 'what did I say about Dan', 'the current message is excluded';
    assert r.content <> 'Dan again', 'other users never appear';
  end loop;
  assert n = 3, 'three own hits incl. the CJK one, got ' || n;
  assert (select count(*) from public.search_messages('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['家喝'], null, 'Asia/Taipei', 4, 5)) = 1, 'CJK substring matches';
  assert (select count(*) from public.search_messages('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['wedding'], null, 'Asia/Taipei', 4, 5)) = 0, 'no match is empty';
end $$;

-- Cascade delete
delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
do $$ begin
  assert (select count(*) from public.drink_entries where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0, 'cascade removed entries';
  assert (select count(*) from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 0, 'cascade removed profile';
end $$;

rollback;
\echo 'schema_test: all assertions passed'
