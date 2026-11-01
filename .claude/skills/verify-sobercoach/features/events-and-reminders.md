# Events and reminders

Future events become rows with a why-now push three hours before; "did you remind me?" is answered from the reminder log; three consent switches control pushes; the proactive path passes seven gates and claims each push atomically.

## Sub-features

- `event-save` `party at Sam's in 5 days` saves a `drinking_social` event at 20:00 local with a receipt line.
- `reminder-save` `Notify me on November 1` or `remind me friday to call mom` saves a `general_reminder` at 12:00 local when no time is given, with `Saved reminder "…"`; the writer confirms, never refuses.
- `reminder-push` a general reminder nudges at its own time with `Reminder: <title> (<when>)`; a social event nudges three hours before with the weekly remaining.
- `event-cancel` `cancel Sam's party` flips `status` to cancelled; its reminder goes with it.
- `reminders-fact` `did you remind me?` prints what was sent, what was blocked and the next nudge, from data.
- `consent-off-on` `stop reminding me` / `turn reminders back on` flip all three `consents` rows.
- `gates` event_prep, morning_after and missed_log pushes pass CONSENT, QUIET_HOURS, DAILY_CAP, WEEKLY_CAP, EVENT_EXISTS, STALE, OPENED_TODAY.

## How to get to it (user POV)

- Coach tab, type the sentences above. Events tab shows the saved event; Settings shows the three switches; Sandbox (wrench) has `Jump to next event − 3 h` and the gate trace.

## Driving it with verify-sobercoach

Preconditions:

- Doctor OK; account reset; no active event.

- **Save.** Type `party at Sam's in 5 days`. API row "Future event becomes a row; receipt line kept for events". Observable: reply begins `Saved "Party at Sam's" for`, `events` has one active row, Events tab lists it.
- **Dated reminder.** Type `Notify, me on November 1`, then `remind me friday to call mom`. API rows "Dated reminder without a time is saved (kind general_reminder, default noon)", "Writer confirms the receipt instead of refusing", "Reminder with a weekday keeps the user's words and reminder kind", "Reminder fact line lists the reminder at its own time (no 3 h lead)", "Per-request client_timezone updates the profile". Observable: `events.kind` general_reminder, `starts_at` 04:00Z (noon Taipei), reply begins `Saved reminder`.
- **Ask.** Type `did you remind me?`. API row "Reminder question answered from data first". Observable: reply begins `No reminder has been sent yet. Next: Party at Sam's`.
- **Cancel.** Type `cancel Sam's party`. API row "Event cancel flips status". Observable: `events.status` cancelled.
- **Consents.** Type `stop reminding me`, then `turn reminders back on`. API rows "Stop reminding me flips all consents off", "Reminders back on". Observable: Settings switches follow.
- **Gates.** Not in the API drive. Run `deno run -A eval/run.ts --url $BASE --anon $ANON --runs 1 --only 3` (event_prep push with why-now), `--only 4` (quiet days, missed_log with cooldown), `--only 5` (consent off blocks the push). Observable: `reminder_log` rows with `status`, `block_reason`, `gate_trace`; the Sandbox shows the green/red gate list.
- **Proof.** `features.log` rows; `eval/results/<label>-*.md` for the gate scenarios; a Sandbox screenshot of the gate trace.

## Gotchas

- Without `--service`, `eval/run.ts` cannot reset the reminder log between runs; a second run within three days sees `missed_log=already_sent`. That is the cooldown working.
- Push delivery to a device cannot be verified here (APNs keys are placeholders); the proof ends at the `reminder_log` row and the gate trace.
- `remind me thursday 2am ...` creates an event named after the reminder text; the push lands three hours before it.
