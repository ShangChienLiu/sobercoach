-- Fixes from code review: SQL-side spend sum for the breaker, and a claim
-- step for reminder sends so overlapping ticks cannot double-send.

create or replace function public.ledger_spend_since(p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.messages where created_at >= p_since
$$;
revoke all on function public.ledger_spend_since(timestamptz) from public;
grant execute on function public.ledger_spend_since(timestamptz) to service_role;

alter table public.reminder_log drop constraint if exists reminder_log_status_check;
alter table public.reminder_log add constraint reminder_log_status_check
  check (status in ('pending','sending','sent','blocked','failed','stale'));
alter table public.reminder_log add column if not exists claimed_at timestamptz;

-- Atomic claim: only one caller wins a pending row. A claim older than 10 minutes
-- is treated as abandoned and can be re-claimed.
create or replace function public.claim_reminder(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  update public.reminder_log
     set status = 'sending', claimed_at = now()
   where id = p_id
     and (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '10 minutes'));
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;
revoke all on function public.claim_reminder(uuid) from public;
grant execute on function public.claim_reminder(uuid) to service_role;
