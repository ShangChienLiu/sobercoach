-- Standing intents come in two kinds; pushes use a different template for each.
alter table public.events
  add column if not exists kind text not null default 'drinking_social'
  check (kind in ('drinking_social','general_reminder'));
comment on column public.events.kind is 'drinking_social: party/dinner, nudged 3 h before with the weekly remaining. general_reminder: call mom / don''t buy beer, nudged at its time with a plain reminder.';
