-- pg_cron calls evaluate-triggers every 15 minutes through pg_net.
-- pg_cron does not retry a failed HTTP call; every candidate push is a
-- reminder_log row keyed by idempotency_key that the next tick picks up.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The function URL and shared secret are stored in vault so the SQL has no literals.
-- Set them once per environment:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/evaluate-triggers', 'trigger_url');
--   select vault.create_secret('<TRIGGER_SECRET>', 'trigger_secret');
create or replace function public.call_evaluate_triggers()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'trigger_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'trigger_secret' limit 1;
  if v_url is null or v_secret is null then
    raise notice 'evaluate-triggers not configured (vault trigger_url/trigger_secret missing)';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-trigger-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

select cron.unschedule('evaluate-triggers') where exists (select 1 from cron.job where jobname = 'evaluate-triggers');
select cron.schedule('evaluate-triggers', '*/15 * * * *', $$select public.call_evaluate_triggers()$$);
