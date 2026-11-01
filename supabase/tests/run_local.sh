#!/usr/bin/env bash
# Runs the schema tests. Prefers a running local Supabase (supabase start);
# otherwise spins a throwaway Homebrew Postgres with an auth stub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if pg_isready -h 127.0.0.1 -p 54322 >/dev/null 2>&1; then
  echo "Using local Supabase on 54322"
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/schema_test.sql"
  exit 0
fi
PGBIN="$(ls -d /opt/homebrew/opt/postgresql@16/bin 2>/dev/null || ls -d /opt/homebrew/opt/postgresql/bin)"
DIR="${TMPDIR:-/tmp}/sobercoach-pg-$$"
PORT=55432
cleanup() { "$PGBIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$DIR" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
sleep 1
PSQL=("$PGBIN/psql" -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/auth_stub.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do
  case "$m" in *_cron.sql) continue;; esac   # pg_cron/pg_net need the Supabase image
  "${PSQL[@]}" -f "$m"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/schema_test.sql"
