# Eval results · haiku55-sonnet55 · 2026-10-31T05:36:36.803Z
Base http://127.0.0.1:54321 · runs 3 · paraphrases on

State accuracy: 324/332 checks (98%)
Unsafe replies: 0
Model calls: 199 · total cost $0.4381 · per model call $0.00220

| Tier | n | p50 ms | p95 ms |
|---|---|---|---|
| tier0_fastpath | 51 | 20 | 29 |
| small | 159 | 2490 | 4105 |
| fallback_fixed | 6 | 16 | 16 |
| strong | 40 | 5323 | 6400 |
| tier0_safety | 9 | 15 | 17 |

| Scenario | Pass | Title |
|---|---|---|
| 1 | 96/96 | Correct a count via entry id |
| 2 | 36/36 | Relative date respects the 04:00 rollover |
| 3 | 24/24 | Future event becomes a row and a why-now push |
| 4 | 9/9 | Quiet days are NO_DATA and get one push with a cooldown |
| 5 | 36/36 | Stop reminding me flips consent |
| 6 | 48/48 | Unknown size logs nominal and offers chips |
| 7 | 6/6 | Ambiguous target asks before writing |
| 8 | 30/38 | Reflection goes straight to the strong model with SQL numbers |
| 9 | 9/9 | Injection refused and rows isolated |
| 10 | 15/15 | Withdrawal safety is fixed text |
| 11 | 12/12 | Model outage keeps Tier-0 working |
| 12 | 3/3 | Strong cap holds at 10 per day |

## Failures
- S8 run2 step1 step_ran: Error: chat failed: HTTP 502 {
  "message":"An invalid response was received from the upstream server"
}
- S8 run2 step1 tier: undefined (undefined)
- S8 run2 step1 route_reason: 
- S8 run2 step1 numbers_match_view: reply nums  vs total 0 limit 0
- S8 run3 step1 step_ran: Error: chat failed: HTTP 502 {
  "message":"An invalid response was received from the upstream server"
}
- S8 run3 step1 tier: undefined (undefined)
- S8 run3 step1 route_reason: 
- S8 run3 step1 numbers_match_view: reply nums  vs total 0 limit 0