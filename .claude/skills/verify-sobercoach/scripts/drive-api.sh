#!/usr/bin/env bash
# Every AI behaviour, one real request each, as Blake. Evidence: transcript + JSON rows.
. "$(dirname "$0")/common.sh"
RUN="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$EVIDENCE_ROOT/$RUN"; mkdir -p "$OUT"
cd "$ROOT"
set +e
deno run -A eval/features.ts --url "$BASE" --anon "$ANON" 2>&1 | tee "$OUT/features.log"
status=${PIPESTATUS[0]}
set -e
latest="$(ls -t eval/results/features-*.json | head -1)"
cp "$latest" "$OUT/features.json"
/usr/bin/find "$ROOT" -name appmap.log -not -path '*/.git/*' -delete 2>/dev/null || true
echo "evidence: $OUT/features.log $OUT/features.json"
exit $status
