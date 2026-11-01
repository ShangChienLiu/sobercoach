---
name: verify-sobercoach
description: "Drive the real SoberCoach app (iOS simulator + hosted Supabase edge functions + real models) the way a user does and capture proof: logs, corrections, hard moments, events and reminders, memory and dreaming, safety and outage. Use for /verify-sobercoach, \"verify the coach\", \"prove the AI features work\", or before any deploy or TestFlight upload."
---

# Verify SoberCoach

SoberCoach has two user surfaces: the iOS app (SwiftUI, simulator) and, behind it, the `chat` edge function on the hosted Supabase project (Tokyo), which is the same backend the app talks to. The API drive is the fast, complete path (every AI behaviour, about two minutes, about $0.05 of model calls); the UI drive proves the app renders it (one XCUITest, about six minutes). Read `features/README.md` for the map, then the feature file you are proving.

Two test accounts exist, both `is_test = true`, password `sobercoach-test`: `blake@test.sobercoach.app` (weekly limit 8) is the API drive's account, `alex@test.sobercoach.app` (limit 10) is the UI drive's. The drives reset their own account at the start. Never drive the account a person is using in the user's own simulator: the booted "iPhone 17" is the user's; the UI drive boots its own "iPhone 17 Pro".

## Launch

The backend is the hosted project; nothing starts locally. Launch means: a built app, a dedicated simulator, and the deployed function version in hand.

```bash
.claude/skills/verify-sobercoach/scripts/launch.sh
```

Ready when it prints `READY chat=v<N> sim=<udid> app=<path>`. It loads keys from `supabase/.env` and the anon key from `ios/SoberCoach/Config/Secrets.xcconfig`, boots `iPhone 17 Pro` (resolved to its UDID; Xcode 27 does not match simulators by name), builds the Debug app for it (`xcodegen generate` first) and installs the app there. It records the simulator it booted in `.verify/run/sim.udid` so cleanup kills only what launch started. Teardown: `scripts/cleanup.sh`.

## Doctor

```bash
.claude/skills/verify-sobercoach/scripts/doctor.sh
```

Read-only. Prints one line per check with OK or FAIL: deployed `chat` and `evaluate-triggers` versions are ACTIVE; the function answers `401` to an unauthenticated POST (alive, gate on); Blake can sign in and `profiles.is_test` is true; the installed app's Info.plist points at `https://the hosted project.supabase.co`; `deno`, `xcodebuild`, `supabase` are on PATH. Run it first whenever anything looks off. Exit code is non-zero on any FAIL.

## Drive

Two harnesses, both shipped here:

- **API drive**: `scripts/drive-api.sh [run-id]` runs `eval/features.ts` against the hosted function as Blake: 43 checks, one per user-facing AI behaviour, each a real request with the real models (Haiku 5.5 tool pass, Sonnet 5.5 writer, Flash-Lite escalation). It saves the console transcript and the JSON rows to `.verify/evidence/<run-id>/`. Exit code non-zero if any check fails.
- **UI drive**: `scripts/drive-ui.sh [run-id]` runs the XCUITest `testSignInLogAndCorrect` on the launched iPhone 17 Pro as Alex (sign in, "2 beers" → card `2 × beer`, "Actually it was 3" → card `3 × beer` with `Before: 2`, Undo from the card → `Restored 2 beers`, Today tab shows the week and quick-log buttons), saves the `.xcresult` path and a screenshot of the simulator after the run.
- **Manual drive** (a person in the simulator) uses the exact strings in each feature file; evidence is a screenshot (`xcrun simctl io <udid> screenshot <path>`) plus the Sandbox ledger row's `route_reason`.

Stable handles: the text field placeholder `Had 2 beers…`, the send button `arrow.up.circle.fill`, the card text `<count> × <drink> · <Day, Mon D>`, the card button `Undo`, the keyboard toolbar button `keyboardDone`, tab bar buttons `Today`, `Coach`, `Events`, `Settings`, Settings section titles `What the coach remembers` and `What the coach has pieced together`.

## Evidence

Everything goes under `.verify/evidence/<run-id>/` (gitignored): `doctor.txt`, `features.log` and `features.json` (every check with its PASS/FAIL and the reply or row it saw), `ui.log`, `ui.xcresult.path`, `ui-after.png`. Proof standards:

- Exercise the real user path: typed messages and taps, never direct table writes. The only test-only endpoints allowed are `reset_test_data` (to start clean) and `debug.simulate_outage` (which is itself a feature under test).
- Capture the action and the resulting state: the reply text, the card, and the database side effect read back through the user's own REST token (`coach_memory`, `events`, `consents`, `profiles.soul_profile`, `messages.route_reason`).
- Side effects are part of the proof: a log must produce a `drink_entries` row visible on the Today tab; "stop reminding me" must flip all three `consents` rows; the dreaming pass must write `profiles.soul_profile`.
- Mocks only where production already isolates the boundary: `OPENROUTER_API_KEY=mock` exists for the orchestration suite (`eval/run.ts` locally) and is never used here; this skill proves the real models.
- Push delivery to a device cannot be proven from this machine (APNs keys are placeholders); the proactive path is proven to the gate decision and the `reminder_log` row via `eval/run.ts` scenarios 3 to 5, which the API drive does not repeat.

## Cleanup

```bash
.claude/skills/verify-sobercoach/scripts/cleanup.sh
```

Shuts down only the simulator recorded in `.verify/run/sim.udid`, removes `.verify/run/`, and resets the Blake and Alex test accounts through the function's own `reset_test_data` action so the next person starts clean. It never touches `.verify/evidence/`. Never `pkill` by name: the user's own simulator and Xcode stay up.

## Helpers

All scripts are executable and take no arguments except an optional run id (default: UTC timestamp):

| Script | What it does |
|---|---|
| `scripts/launch.sh` | keys, build, boot iPhone 17 Pro, install, print READY |
| `scripts/doctor.sh` | read-only health lines, exit 1 on any FAIL |
| `scripts/drive-api.sh [run]` | 43 real-model checks as Blake, evidence saved |
| `scripts/drive-ui.sh [run]` | XCUITest as Alex on the launched simulator, screenshot saved |
| `scripts/cleanup.sh` | shut down our simulator, reset test accounts, keep evidence |

Full pass, in order: `launch.sh && doctor.sh && drive-api.sh r1 && drive-ui.sh r1; cleanup.sh`. Keep the map honest with `/maintain-verification-skill` when features change.
