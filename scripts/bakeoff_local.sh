#!/usr/bin/env bash
# Runs the acceptance suite against each model configuration on the local stack.
# usage: ./scripts/bakeoff_local.sh [runs]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
RUNS="${1:-3}"
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
ANON="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
SERVICE="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
for pair in "supabase/.env:haiku55-flashlite" "supabase/.env.luna:luna-flashlite" "supabase/.env.sonnet:haiku55-sonnet55"; do
  envfile="${pair%%:*}"; label="${pair##*:}"
  echo "=== $label ($envfile) ==="
  supabase functions serve --env-file "$envfile" > ".build/serve-$label.log" 2>&1 &
  pid=$!
  for i in $(seq 1 60); do grep -q "Serving functions" ".build/serve-$label.log" 2>/dev/null && break; sleep 1; done
  sleep 3
  deno run -A eval/run.ts --url http://127.0.0.1:54321 --anon "$ANON" --service "$SERVICE" --runs "$RUNS" --paraphrases --label "$label" 2>&1 | sed -n '4,6p;/| Tier/,$p'
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  pkill -f "supabase functions serve" 2>/dev/null; sleep 2
done
echo "=== bake-off complete ==="
