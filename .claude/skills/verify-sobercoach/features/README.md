# SoberCoach verification map

The maintained source for verifying what a user sees and gets from SoberCoach. Read this index, then the feature file, then drive it with the `verify-sobercoach` scripts (`../SKILL.md`).

## Baseline preconditions

- `scripts/launch.sh` printed `READY` and `scripts/doctor.sh` is all OK.
- API drives use Blake (`blake@test.sobercoach.app`, limit 8); UI and manual drives use Alex (limit 10). Both start from `reset_test_data`.
- The user's own "iPhone 17" simulator is never driven; ours is the "iPhone 17 Pro" that launch booted.
- Blake's timezone is America/Los_Angeles with a 04:00 rollover, so a "today" at 05:00 Pacific is the previous service day's night.

## Driving conventions

- Type the exact strings in the recipes; the fast path and the pre-flight routing are regex-based, so wording matters.
- Read side effects back through the user's own REST token, never the service key: `drink_entries`, `events`, `consents`, `coach_memory`, `profiles?select=soul_profile`, `messages?select=route_reason`.
- Every reply carries `route_reason`; it is the audit trail of which gate did what (`fastpath:log`, `soul:strong:emotional`, `guard:restatement_removed`, `receipt_in_card`). Record it with every artifact.
- Wait for the reply, not a fixed sleep: Sonnet turns take 3 to 8 seconds.

## Proof and skip reporting

- UI proof: a screenshot that shows the Coach screen with the bubble and the card, plus the ledger row from the Sandbox (wrench button) with its `route_reason`.
- API proof: the request, the reply, the card JSON and the read-back row, as `eval/features.ts` records them.
- A reply that is empty, ends mid-sentence, or starts with "Got it", "Noted", "Sure" fails the feature regardless of state.
- Report an unreachable path with the attempted command and the unmet precondition; the strong-writer cap (10 a day per account) is the usual one: `soul:light:capped` in `route_reason` means the account's cap is spent, not that routing is broken.

## Feature entry contract

Each feature file has an H1, one paragraph, then exactly: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-sobercoach`, `Gotchas`.

## Features

- [Log, correct, undo](./log-and-correct.md): typed and button logging, corrections by entry id, relative days, size chips, receipts in the card, zero-question routine lines.
- [Hard moments and reflection](./hard-moments.md): emotional and reflective turns routed to the strong writer, one question at most, summary line from SQL.
- [Events and reminders](./events-and-reminders.md): saving, cancelling, "did you remind me", consent switches, the proactive gates.
- [Memory and dreaming](./memory-and-dreaming.md): facts the user states, the background profile, Settings display, reset.
- [Safety and outage](./safety-and-outage.md): fixed safety cards, injection refusal, standard-drink fact, simulated outage, spend breaker, strong cap.
