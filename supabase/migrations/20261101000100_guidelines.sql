-- Guideline layer (US basis). Sex drives the NIAAA low-risk, binge and heavy-day lines;
-- AUDIT-C (USPSTF 2018 screening recommendation) is taken once at onboarding and user-editable.
alter table public.profiles
  add column if not exists sex_for_guidelines text check (sex_for_guidelines in ('male','female')),
  add column if not exists audit_c_score smallint check (audit_c_score between 0 and 12),
  add column if not exists audit_c_answers jsonb,
  add column if not exists audit_c_at timestamptz;

comment on column public.profiles.sex_for_guidelines is 'Optional. NIAAA thresholds are sex-specific; null applies the lower (women''s) lines.';
comment on column public.profiles.audit_c_score is 'AUDIT-C total 0-12 from onboarding. Positive at 4+ (men) / 3+ (women); 8+ suggests a clinician assessment.';
