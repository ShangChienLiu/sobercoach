#!/usr/bin/env bash
# Tear down what this run started; reset the test accounts; keep every proof artifact.
. "$(dirname "$0")/common.sh"
if [[ -f "$RUN_DIR/sim.udid" ]]; then
  UDID="$(cat "$RUN_DIR/sim.udid")"
  xcrun simctl shutdown "$UDID" 2>/dev/null && echo "shut down simulator $UDID" || echo "simulator $UDID already down"
  rm -rf "$RUN_DIR"
fi
for u in blake alex; do
  TOK="$(token_for "$u")"
  [[ -n "$TOK" ]] || { echo "could not sign in as $u"; continue; }
  curl -s -X POST "$BASE/functions/v1/chat" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"action":{"type":"reset_test_data"}}' | python3 -c "import sys,json;print('$u reset:', json.load(sys.stdin).get('success'))"
done
echo "evidence kept under $EVIDENCE_ROOT"
