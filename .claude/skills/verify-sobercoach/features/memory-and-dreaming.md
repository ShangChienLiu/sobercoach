# Memory and dreaming

Two kinds of memory: facts the user states (kept word for word, up to 14), and a background profile the coach rewrites every five typed turns from logs and messages. Both show in Settings and both clear on "Forget everything" or a test reset.

## Sub-features

- `remember-fact` a stated reason or intention lands in `coach_memory` in the user's words.
- `no-offer` the writer never asks "want me to remember that?"; the tool pass just does it.
- `dream-writes` after five typed turns the background pass writes `profiles.soul_profile` (vibe, patterns, active arc, next nudge).
- `dream-grounded` the profile reflects the user's own facts, not inventions.
- `settings-show` Settings shows `What the coach remembers` (facts) and `What the coach has pieced together` (profile) and reloads after a reset.
- `reset-clears` reset (or Forget everything) empties both, and a late dream pass does not resurrect them.

## How to get to it (user POV)

- Coach tab: type `I'm cutting down because I keep waking up at 4am. Fridays are the problem.` or `I'm stopping from today`.
- Settings tab: scroll to the two memory sections; `Forget everything`.
- Sandbox: `Reset test data`.

## Driving it with verify-sobercoach

Preconditions:

- Doctor OK; account reset.

- **Fact.** Type the 4am sentence. API row "Stated reason is remembered (coach_memory)". Observable: `coach_memory.summary` contains `4am`; Settings lists it under `What the coach remembers`.
- **Intention.** Type `I'm stopping from today`. API rows "Stated intention is remembered", "Writer never offers to remember". Observable: a second bullet in `coach_memory`; the bubble has no "remember".
- **Dream.** Keep typing to five turns (the API drive does). API rows "Dreaming pass wrote a soul profile in the background", "Dreamed profile reflects the user's own facts". Observable within a minute: `profiles.soul_profile` non-empty, mentions Fridays or 4am; Settings section fills on pull-to-refresh.
- **Reset.** Sandbox `Reset test data` (or `reset_test_data`). API row "Reset clears coach_memory and soul_profile (and a late dream does not resurrect them)". Observable: both sections empty after the toast; `turns_since_dream` 0.
- **Proof.** `features.log` rows; Settings screenshot before and after reset.

## Gotchas

- The profile is Haiku's inference; it may phrase a stated intention as a goal. Only the facts section is verbatim.
- The dream runs after the response is sent (`EdgeRuntime.waitUntil`); allow up to a minute.
- Settings reloads on any toast and on pull-to-refresh; a stale section means neither happened.
