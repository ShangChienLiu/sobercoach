#!/usr/bin/env bash
# Deploy schema, secrets and functions to a hosted Supabase project.
# Prerequisite: `supabase login` (interactive, once) and a project ref.
# Usage: PROJECT_REF=abcd1234 ./scripts/deploy_backend.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
: "${PROJECT_REF:?set PROJECT_REF}"
[[ -f supabase/.env ]] || { echo "supabase/.env missing (copy .env.example)"; exit 1; }
grep -q '^OPENROUTER_API_KEY=sk-' supabase/.env || echo "warning: OPENROUTER_API_KEY in supabase/.env is not a real key"

supabase link --project-ref "$PROJECT_REF"
supabase db push
# ENVIRONMENT=demo keeps the test-account time simulator usable for reviewers;
# pass ENVIRONMENT=production for a real release (simulator and forced pushes refused).
supabase secrets set --env-file supabase/.env ENVIRONMENT="${ENVIRONMENT:-demo}"
supabase functions deploy chat
supabase functions deploy evaluate-triggers --no-verify-jwt

SECRET="$(grep '^TRIGGER_SECRET=' supabase/.env | cut -d= -f2-)"
cat <<SQL

Run once in the SQL editor to arm the scheduler and seed test accounts:
  select vault.create_secret('https://$PROJECT_REF.supabase.co/functions/v1/evaluate-triggers', 'trigger_url');
  select vault.create_secret('$SECRET', 'trigger_secret');
  -- then paste supabase/seed.sql

Then set SUPABASE_URL=https://$PROJECT_REF.supabase.co and the anon key from
  supabase projects api-keys --project-ref $PROJECT_REF
in ios/SoberCoach/Config/Secrets.xcconfig.
SQL
