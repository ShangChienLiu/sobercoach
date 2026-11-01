-- search_history tool: full-text lookup over the user's own chat ledger.
-- Searches what the USER said (not coach lines, which would echo earlier search results, and not
-- the questions the user asked the coach). Substring match per term (case-insensitive, works for CJK without an extension),
-- ranked by how many terms matched and then recency. Each hit carries the service day
-- it fell on and that day's logged standard drinks, so the coach quotes verified figures.
-- Runs as the caller (RLS: messages_owner_read), so a user can only search their own rows.

create or replace function public.search_messages(
  p_user_id uuid,
  p_terms text[],
  p_exclude text,
  p_tz text,
  p_rollover integer,
  p_limit integer default 5
)
returns table (
  created_at timestamptz,
  role text,
  content text,
  matched integer,
  service_date date,
  std_drinks numeric
)
language sql stable security invoker set search_path = public as $$
  with hits as (
    select m.created_at, m.role, m.content,
      (select count(*) from unnest(p_terms) t where m.content ilike '%' || t || '%')::integer as matched,
      ((m.created_at at time zone p_tz) - make_interval(hours => p_rollover))::date as service_date
    from public.messages m
    where m.user_id = p_user_id
      and m.role = 'user'
      and m.content !~ '[?？]\s*$'
      and m.created_at >= now() - interval '180 days'
      and (p_exclude is null or m.content <> p_exclude)
  )
  select h.created_at, h.role, h.content, h.matched, h.service_date,
    (select sum(coalesce(d.std_drinks_exact, d.std_drinks_nominal)) from public.drink_entries d
      where d.user_id = p_user_id and d.service_date = h.service_date and d.status = 'active') as std_drinks
  from hits h
  where h.matched > 0
  order by h.matched desc, h.created_at desc
  limit greatest(1, least(p_limit, 10))
$$;
revoke all on function public.search_messages(uuid, text[], text, text, integer, integer) from public;
grant execute on function public.search_messages(uuid, text[], text, text, integer, integer) to authenticated, service_role;
