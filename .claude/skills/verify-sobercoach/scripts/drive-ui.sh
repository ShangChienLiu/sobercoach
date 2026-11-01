#!/usr/bin/env bash
# The XCUITest user journey as Alex on the simulator launch.sh booted. Evidence: log, xcresult path, screenshot.
. "$(dirname "$0")/common.sh"
RUN="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$EVIDENCE_ROOT/$RUN"; mkdir -p "$OUT"
UDID="$(cat "$RUN_DIR/sim.udid" 2>/dev/null || true)"
[[ -n "$UDID" ]] || { echo "run launch.sh first (no .verify/run/sim.udid)"; exit 1; }
cd "$ROOT/ios/SoberCoach"
RESULT="$OUT/ui.xcresult"
set +e
xcodebuild -project SoberCoach.xcodeproj -scheme SoberCoach -destination "platform=iOS Simulator,id=$UDID" -resultBundlePath "$RESULT" test 2>&1 | grep -E "error:|Executed|Test Case.*(passed|failed)|TEST (SUCCEEDED|FAILED)" | tee "$OUT/ui.log"
status=${PIPESTATUS[0]}
set -e
echo "$RESULT" > "$OUT/ui.xcresult.path"
xcrun simctl io "$UDID" screenshot "$OUT/ui-after.png" >/dev/null 2>&1 || true
/usr/bin/find "$ROOT" -name appmap.log -not -path '*/.git/*' -delete 2>/dev/null || true
echo "evidence: $OUT/ui.log $OUT/ui-after.png $RESULT"
exit $status
