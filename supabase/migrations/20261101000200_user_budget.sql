-- Per-user daily model budget: the chat function sums this user's spend since the
-- start of their service day and drops the writer to the budget model when it is over.

create or replace function public.ledger_user_spend_since(p_user_id uuid, p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0)
  from public.messages
  where user_id = p_user_id and role = 'assistant' and created_at >= p_since
$$;
revoke all on function public.ledger_user_spend_since(uuid, timestamptz) from public;
grant execute on function public.ledger_user_spend_since(uuid, timestamptz) to service_role;

