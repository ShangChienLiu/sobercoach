#!/usr/bin/env bash
# Shared environment for the verify-sobercoach scripts. Source, don't run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
export ROOT
if [[ -f "$ROOT/supabase/.env" ]]; then set -a; . "$ROOT/supabase/.env"; set +a; fi
PROJECT_REF="${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF in supabase/.env}"
BASE="https://${PROJECT_REF}.supabase.co"
export PROJECT_REF BASE
ANON="$(grep SUPABASE_ANON_KEY "$ROOT/ios/SoberCoach/Config/Secrets.xcconfig" | sed 's/.*= *//')"
export ANON
SIM_NAME="iPhone 17 Pro"
export SIM_NAME
RUN_DIR="$ROOT/.verify/run"
EVIDENCE_ROOT="$ROOT/.verify/evidence"
export RUN_DIR EVIDENCE_ROOT
APP_PATH="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/SoberCoach-*/Build/Products/Debug-iphonesimulator/SoberCoach.app 2>/dev/null | head -1 || true)"
export APP_PATH
sim_udid() { xcrun simctl list devices available | grep -E "^\s+${SIM_NAME} \(" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
token_for() { curl -s -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$1@test.sobercoach.app\",\"password\":\"sobercoach-test\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))'; }
