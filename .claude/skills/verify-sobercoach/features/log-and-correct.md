# Log, correct, undo

A user types what they drank in plain words (or taps a quick-log button), the app records it on the right service day, shows a card with the exact entry, and the coach adds one or two human sentences without a receipt or a question. Corrections and undo change the same entry and keep the history.

## Sub-features

- `log-typed` a typed message like `2 beers` becomes an entry; the bubble has words, the card has the receipt.
- `log-zero-question` routine logs never end in a question.
- `log-button` quick-log buttons write at $0 with a receipt line and no writer.
- `correct-count` `actually it was 3` updates the same entry; the card shows `Before: 2`.
- `correct-day` `those were last night` moves the entry to the previous service day.
- `correct-ambiguous` two candidate entries produce "Which one do you mean?" with tappable options and no write.
- `size-chips` an unmeasured drink is nominal (`est.`) and offers size chips; a chip makes it exact.
- `undo` the card's Undo (or typed `undo`) marks the entry undone and restores the previous version.

## How to get to it (user POV)

- Coach tab: type in the field labelled `Had 2 beers…`, tap the up-arrow button.
- Today tab: tap a quick-log button (`Beer`, `Wine`, ...), tap `Undo` on an entry, tap a size chip on an estimated entry.

## Driving it with verify-sobercoach

Preconditions:

- Doctor is all OK; the account was just reset.

- **Typed log.** Type `2 beers`. API: `scripts/drive-api.sh` rows "Regex fast path writes and the writer speaks", "Routine log: receipt in card, not in bubble", "Routine log: zero questions", "Routine log: no unverified digits". UI: XCUITest step waits for static text beginning `2 × beer`. Observable: card `2 × beer · <Day, Mon D>` with `~2.0 (est.)`, bubble without `Logged`, `route_reason` begins `fastpath:log` and ends `receipt_in_card`, Today tab total 2.0.
- **Correct count.** Type `actually it was 3`. API row "Correction updates the same entry (card before/after)". UI: static text `3 × beer` and `Before: 2`. Observable: same `entry_id`, `drink_entries.version` 2, `previous_snapshot` holds count 2.
- **Correct day.** Type `those were last night`. API row "Relative-day correction moves the service date". Observable: card `service_date` is the previous day; Today tab drops to NO DATA if nothing else was logged today.
- **Ambiguous.** Type `1 beer` twice, then `change the beer to 2`. API row "Ambiguous correction asks with tappable options, writes nothing"; then `choose_entry` with the first option: row "Chosen entry is corrected deterministically". Observable: `clarify.options.length >= 2`, no `drink_entries` change until a choice.
- **Size chips.** Type `glass of wine`, then tap the first chip. API rows "Unknown size logs nominal and offers size chips", "Size chip makes the entry exact". Observable: `is_estimate` true then false; Today total loses `(est.)` for that entry.
- **Buttons.** Tap `Beer` on Today, then `Undo`. API rows "Quick-log button: receipt only, $0, card", "Undo button restores/removes and prints receipt". Observable: reply begins `Logged 1 beer` / `Removed 1 beer`, `cost_usd` 0.
- **Proof.** `scripts/drive-api.sh <run>` leaves `features.log` and `features.json`; for the UI, `scripts/drive-ui.sh <run>` leaves `ui.log` with `testSignInLogAndCorrect passed` and `ui-after.png`.

## Gotchas

- `2 beers` must be the whole message for the regex fast path; `I had 2 beers tonight` goes through the Haiku tool pass instead (same result, one model call).
- A log between 23:00 and 04:00 Pacific, a second separate log within two hours, or a log that pushes the week past the limit routes the words to Sonnet and counts against the daily cap of 10.
- When the cap is spent, `route_reason` shows `soul:light:capped`; the write is still correct.
- Receipts stay in the bubble for events, limits and reminder settings (there is no card for those).
