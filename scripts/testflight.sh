#!/usr/bin/env bash
# Archive, sign and upload SoberCoach to TestFlight.
#
# One-time prerequisites (cannot be scripted):
#   1. Xcode > Settings > Accounts: sign in with the Apple ID that belongs to team $TEAM_ID.
#   2. developer.apple.com: App ID app.sobercoach.ios with Push Notifications; an APNs key (.p8).
#   3. App Store Connect: create the app record for app.sobercoach.ios.
#   4. ios/SoberCoach/Config/Secrets.xcconfig: hosted SUPABASE_URL, SUPABASE_ANON_KEY, DEVELOPMENT_TEAM.
#
# Usage: TEAM_ID=97A6MK4B7T ./scripts/testflight.sh
#   Optional: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH for an App Store Connect API key
#   (otherwise the upload uses the Apple ID signed into Xcode).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/ios/SoberCoach"
TEAM_ID="${TEAM_ID:?set TEAM_ID}"
OUT="$ROOT/.build/testflight"
ARCHIVE="$OUT/SoberCoach.xcarchive"
mkdir -p "$OUT"
find "$ROOT" -name appmap.log -not -path '*/.git/*' -delete 2>/dev/null || true

cd "$PROJ"
xcodegen generate
sed "s/\$(DEVELOPMENT_TEAM)/$TEAM_ID/" ExportOptions.plist > "$OUT/ExportOptions.plist"

BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
# With an App Store Connect API key that has the Admin or Developer role (and
# "Access to Certificates, Identifiers & Profiles"), both the archive and the
# export can provision headlessly; otherwise an Apple ID signed into Xcode is used.
AUTH=()
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  AUTH=(-authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" -authenticationKeyPath "$ASC_KEY_PATH")
fi
xcodebuild -project SoberCoach.xcodeproj -scheme SoberCoach -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -allowProvisioningUpdates "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates "${AUTH[@]}"

echo "Uploaded to App Store Connect. Processing takes 5-15 minutes; then add testers in TestFlight."
