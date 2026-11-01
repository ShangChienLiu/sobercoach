# Hard moments and reflection

When the user is struggling (shame, a craving, insomnia, a blackout, pressure from family, anger at the coach) or asks about their week, the strong writer answers: the human part first, then at most one question, with figures printed by code.

## Sub-features

- `emotional-route` emotional messages are detected before any model and written by Sonnet 5.5.
- `blackout-logs` "8 beers and I don't remember getting home" logs the drinks and still gets a human line, not a safety card.
- `reflect-summary` "how's my week going" prints the SQL summary line first (`This week (...): x of y standard drinks`), then one or two sentences.
- `one-question` never more than one question mark.
- `no-therapy-speak` no "I hear you", "I'm here for you", "Great job"; in Chinese no "我聽到你說", "我在這裡陪你".
- `annoyed` "you're kind of annoying" is met with fewer questions.

## How to get to it (user POV)

- Coach tab, type any of: `I feel like crap today`, `I blew it last night. 8 beers and I don't even remember getting home.`, `I really want a drink right now`, `it's 1am and I can't sleep`, `my brother keeps pushing shots on me`, `why do I always end up drinking more on fridays`, `how's my week going`, `我覺得我做不到`.

## Driving it with verify-sobercoach

Preconditions:

- Doctor OK; the account's strong cap is not spent (fewer than 10 strong calls today; a reset clears it).

- **Emotional.** Type `I feel like crap today`. API row "Emotional turn: strong writer, human line, at most one question". Observable: `route_reason` contains `preflight_emotional+soul:strong:emotional+strong_call`, `model` is `anthropic/claude-sonnet-5.5`, one or zero `?`.
- **Blackout.** Type the blackout sentence. API row "Blackout: logs the drinks AND speaks (not a risk flag)". Observable: card count 8, `safety` null, bubble names the scary part.
- **Reflection.** Type `how's my week going`. API rows "Reflection: summary line printed by code with the real total", "Reflection routed to the strong writer". Observable: reply begins `This week (` with the same total as `state.weekly_total`.
- **Chinese hard moment.** Type `我覺得我做不到`. API row "Chinese emotional turn: Chinese, complete, ≤1 question". Observable: Traditional Chinese, ends with punctuation, no therapy openers.
- **Proof.** `features.log` rows above; a UI screenshot of the bubble with its meta line showing `strong · claude-sonnet-5.5`.

## Gotchas

- Sonnet turns take 3 to 8 seconds; the keyboard `Done` button is in the toolbar if the tab bar is covered.
- The 35-turn `make tone` script exhausts the cap around turn 18; later emotional turns legitimately show `soul:light:capped`.
- A cut-off line is a failure: the writer's budget is 1,400 tokens including hidden reasoning, and the guard drops an unfinished tail; if a fragment ever shows, record the `route_reason` (`soul_truncated`).
