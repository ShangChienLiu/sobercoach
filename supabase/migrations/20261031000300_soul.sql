-- SOUL layer: a background-consolidated profile the writer reads every turn,
-- plus the counter that schedules the next consolidation.
alter table public.profiles
  add column if not exists soul_profile text not null default '',
  add column if not exists soul_profile_updated_at timestamptz,
  add column if not exists turns_since_dream integer not null default 0;

comment on column public.profiles.soul_profile is 'Dreaming-pass summary (vibe, patterns, active arc, next nudge). Under 250 tokens. User-clearable.';
