-- Two test accounts (A and B) for the reviewer sandbox and the RLS isolation
-- scenario. Passwords are "sobercoach-test". Both are server-flagged is_test.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex@test.sobercoach.app', crypt('sobercoach-test', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Alex"}', now(), now(), '', '', '', '', '', '', '', '', false),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'blake@test.sobercoach.app', crypt('sobercoach-test', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Blake"}', now(), now(), '', '', '', '', '', '', '', '', false)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"alex@test.sobercoach.app"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"blake@test.sobercoach.app"}', 'email', now(), now(), now())
on conflict do nothing;

update public.profiles set is_test = true, age_confirmed = true, display_name = 'Alex', weekly_limit = 10
  where user_id = '11111111-1111-1111-1111-111111111111';
update public.profiles set is_test = true, age_confirmed = true, display_name = 'Blake', weekly_limit = 14
  where user_id = '22222222-2222-2222-2222-222222222222';

-- Blake has a private log that Alex must never see.
insert into public.drink_entries (user_id, occurred_at, beverage, count, std_drinks_nominal, source)
values ('22222222-2222-2222-2222-222222222222', now() - interval '3 hours', 'wine', 2, 2, 'quick_log');
