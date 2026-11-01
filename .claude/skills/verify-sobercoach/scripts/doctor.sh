#!/usr/bin/env bash
# Read-only: is this stack worth driving?
. "$(dirname "$0")/common.sh"
fail=0
ok() { echo "OK    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
for t in deno xcodebuild supabase; do command -v "$t" >/dev/null && ok "$t on PATH" || bad "$t missing"; done
LIST="$(supabase functions list --project-ref "$PROJECT_REF" 2>/dev/null || true)"
echo "$LIST" | grep -qE '\| chat .*ACTIVE' && ok "chat deployed and ACTIVE ($(echo "$LIST" | grep -E '\| chat ' | awk -F'|' '{gsub(/ /,"",$5); print "v"$5}'))" || bad "chat not ACTIVE (is 'supabase login' current?)"
echo "$LIST" | grep -qE '\| evaluate-triggers .*ACTIVE' && ok "evaluate-triggers deployed and ACTIVE" || bad "evaluate-triggers not ACTIVE"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/functions/v1/chat" -H 'Content-Type: application/json' -d '{}')"
[[ "$code" == "401" ]] && ok "chat answers 401 without a session (alive, auth gate on)" || bad "chat answered $code to an unauthenticated POST"
TOK="$(token_for blake)"
[[ -n "$TOK" ]] && ok "blake can sign in" || bad "blake sign-in failed"
if [[ -n "$TOK" ]]; then
  IS_TEST="$(curl -s "$BASE/rest/v1/profiles?select=is_test" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;r=json.load(sys.stdin);print(r[0]["is_test"] if r else "")')"
  [[ "$IS_TEST" == "True" ]] && ok "blake is a test account (reset and time jumps allowed)" || bad "blake is_test=$IS_TEST"
fi
if [[ -n "$APP_PATH" && -f "$APP_PATH/Info.plist" ]]; then
  URL="$(plutil -extract SUPABASE_URL raw "$APP_PATH/Info.plist" 2>/dev/null || true)"
  [[ "$URL" == "$BASE" ]] && ok "built app points at $URL" || bad "built app points at '${URL:-none}' (Base.xcconfig must include Secrets.xcconfig last)"
else bad "no built app in DerivedData (run launch.sh)"; fi
[[ -f "$RUN_DIR/sim.udid" ]] && ok "our simulator recorded: $(cat "$RUN_DIR/sim.udid")" || echo "note  no simulator launched by us yet (launch.sh)"
exit $fail
