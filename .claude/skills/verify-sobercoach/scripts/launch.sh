#!/usr/bin/env bash
# Build the app, boot our own simulator, install, and report the deployed function version.
. "$(dirname "$0")/common.sh"
mkdir -p "$RUN_DIR"
UDID="$(sim_udid)"
[[ -n "$UDID" ]] || { echo "no simulator named ${SIM_NAME}"; exit 1; }
# Xcode 27 resolves simulators reliably by id, not by name.
xcrun simctl boot "$UDID" 2>/dev/null || true
cd "$ROOT/ios/SoberCoach"
xcodegen generate >/dev/null
xcodebuild -project SoberCoach.xcodeproj -scheme SoberCoach -destination "platform=iOS Simulator,id=${UDID}" -configuration Debug build 2>&1 | grep -E 'error:|BUILD' | sed 's/^/build: /'
APP_PATH="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/SoberCoach-*/Build/Products/Debug-iphonesimulator/SoberCoach.app | head -1)"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP_PATH"
echo "$UDID" > "$RUN_DIR/sim.udid"
VER="$(supabase functions list --project-ref "$PROJECT_REF" 2>/dev/null | grep -E '\| chat ' | awk -F'|' '{gsub(/ /,"",$5); print $5}')"
/usr/bin/find "$ROOT" -name appmap.log -not -path '*/.git/*' -delete 2>/dev/null || true
echo "READY chat=v${VER:-?} sim=$UDID app=$APP_PATH"
