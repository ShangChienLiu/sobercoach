# Core-mechanism audit (2026-11-01 02:20, chat v51, evaluate-triggers v8)

Method (pstack "prove it works"): every claim in the six-core spec is paired with the code that implements it and a run that shows it. A row with only a code pointer is marked **static**. Runtime rows come from `eval/features.ts` (48/48), `eval/core_probes.ts` (9/9, `eval/results/core-probes-2026-10-31T17-56-07-081Z.json`), `eval/run.ts` scenarios, a live breaker trip, a trigger dry run, and SQL read back from the hosted database.

## Core 1: Sentinel and environment sync

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| Every request carries the device timezone; profile follows it, 04:00 rollover moves with it | `ios/.../ChatAPI.swift` `clientTimezone`; `chat/index.ts` `validTimezone` + profile update before the turn | features: "Per-request client_timezone updates the profile" PASS; profile read back `Asia/Taipei` | proven |
| Crisis / withdrawal / driving words answered by fixed text before any model, /bin/zsh | `_shared/safety.ts`, gate 1 in `chat/index.ts` | core_probes: crisis → `tier0_safety`, `988`, /bin/zsh; features: driving and withdrawal PASS | proven |
| Global $25/day breaker blocks the model path but not the fast path | `chat/index.ts` `GLOBAL_BREAKER_USD`, `ledger.globalSpendLast24h` (fails closed) | live trip with `GLOBAL_DAILY_SPEND_USD=0.000001`: "how is my week going" → `fallback_fixed · global_spend_breaker`; "2 beers" → `tier0_fastpath · fastpath:log+global_spend_breaker` with card; restored to 25 and confirmed | proven |
| Local time in the envelope | `client_now` honored for test accounts only; production uses server time by design | features/run.ts time jumps | proven (by design, test accounts) |

## Core 2: AGENTS extraction, loose schema, strict code

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| The extraction model outputs tools + intent, never words | `prompt.ts` ENVELOPE_SCHEMA (no reply field; `grep post_commit_reply` = 0) | static + every features turn: words come from the SOUL pass (`soul:` in route_reason) | proven |
| Atomic nullable fields; missing time is null, never guessed | `prompt.ts` `date`/`time`/`days_from_now` nullable; `prompt_test` keeps unions ≤ 16 | features: "Dated reminder without a time is saved (kind general_reminder, default noon)" PASS | proven |
| Ambiguous correction asks, writes nothing | `tier0.ts preflightRoute` clarify; model `clarify` | features: "Ambiguous correction asks with tappable options, writes nothing" PASS; run.ts scenario 7 | proven |

## Core 3: Deterministic ledger and execution receipt

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| Code fills defaults (reminder 12:00, social 20:00) and decides party vs reminder | `_shared/events.ts` | `events_test` 3/3; features reminder rows; DB `events.kind` | proven |
| Undo is a mark, not a delete | `tools_exec.undoEntry` | core_probes: row kept with `status=undone, version=2` | proven |
| NO_DATA is not 0 | `daily_totals` view; `state.today` | core_probes: `state.today="NO_DATA"` | proven |
| SQL computes the verified state and the receipt | `chat/index.ts verifiedStateFor`, `finishTurn` confirmations → `<execution_receipt>` | features: receipt in card, summary line with real total; soul_test receipt block | proven |
| RLS on every table | migration 20261031000000 | SQL read back: `rowsecurity = t` on all 7 tables; run.ts scenario 9 rows isolated | proven |

## Core 4: Behavioral escalation router

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| Emotional / reflective → strong writer | `tier0.ts` EMOTIONAL/REFLECTION, `soul.ts shouldEscalateToSonnet` | features: both PASS | proven |
| Over the limit after this log → strong | same | core_probes: `soul:strong:over_goal` with remaining 0 | proven |
| Second separate log within 2 h → strong | same (`entriesLast2h`) | core_probes: `soul:strong:rapid_pacing` | proven |
| Log between 23:00 and 04:00 local → strong | same (`localHour`) | core_probes: `soul:strong:late_night` at 23:30 Taipei; 19:00 stays `soul:light` | proven |
| Daily cap of 10 strong attempts | `STRONG_CAP`, `strongCallsSince` counts `strong_call` marks | run.ts scenario 12 2/2; cap visible as `soul:light:capped` in later turns | proven |
| Per-user daily model budget ($0.15) drops the writer to Haiku and blocks every escalation, fails closed | `chat/index.ts` `USER_BUDGET_USD`, `ledger.userSpendSince` → SQL `ledger_user_spend_since`, `soul.ts shouldEscalateToSonnet` (`budget`) and `writerPlan` | live trip on 2026-11-01 with `USER_MODEL_BUDGET_USD_PER_DAY=0.000001` on the Alex account: "had 4 beers tonight at Dan's, feeling rough" → `small · soul:light:budget` on Haiku, words still delivered; "actually the first beer was 2 and the last one was 3" → `preflight_multi_entry+budget_capped+clarify`; restored to 0.15: same turns `strong · soul:strong:emotional` and `preflight_multi_entry+strong_call` on Sonnet | proven |
| search_history quotes the user's own earlier words with verified day totals, never a model memory | `_shared/history.ts`, SQL `search_messages` (RLS-scoped, user rows only, questions excluded), prompt rule "never invent a memory" | schema_test assertions (ranking, exclusion of the current message and of other users, CJK match, day total); live probe 2026-11-01: "what did I say about Dan's?" → tool call `search_history`, fact line with date and logged total; "did I ever mention a wedding?" → "Nothing earlier about \"wedding\" in our chats." | proven |
| The coach never names its model or vendor | `soul.ts` SOUL_PROMPT identity paragraph; guard `VENDOR` → `IDENTITY_LINE` (`identity_fixed`) | soul_test EN/ZH; live probe 2026-11-01: identity questions in EN and ZH answered as SoberCoach's coach, no vendor named | proven |

## Core 5: SOUL voice and micro-guard

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| Inputs: SOUL prompt + profile + verified numbers + receipt + recent turns | `soul.ts buildSoulUser` | soul_test "receipt block carries the confirmation"; runtime lines cite remaining/limit correctly | proven |
| Receipt is the single capability truth; supported-actions derived from the tool registry | `soul.ts supportedActions()` from `prompt.ts TOOL_DESCRIPTIONS` | features: "Writer confirms the receipt instead of refusing" PASS | proven |
| Routine logs: no question, no opener; hard moments: one question | `soul.ts` prompt + guard `maxQuestions` | features: zero-question PASS; emotional ≤ 1 question PASS; core_probes routine line | proven |
| Hallucinated figures removed per sentence, no 15-word cut, no blank check for typed turns | `soul.ts postProcessSoulReply`, `cutFragment` | soul_test 20+ cases; features "no unverified digits", "no truncated fragment" | proven |
| MI register on slips (no lecture, person vs night) | `soul.ts` anchors 2 and 5 | judge: judgmental 0 on runs v20–v25 | prompt-level, judged by model |

## Core 6: Dreaming and gated heartbeat

| Claim | Code | Evidence | Verdict |
|---|---|---|---|
| Every 5 typed turns a Haiku pass rewrites a < 250-token profile, loaded at zero latency | `_shared/dream.ts`, `chat/index.ts scheduleDream` (waitUntil) | features: profile written, grounded; nine passes for $0.003 on 2026-10-31 | proven |
| Reset does not resurrect a profile | `dream.ts` empty-record guard | features: "Reset clears … late dream does not resurrect" PASS | proven |
| 15-minute heartbeat with seven $0 SQL gates | `cron.job evaluate-triggers */15` (read back, active); `_shared/gates.ts` | run.ts scenarios 3, 4, 5 (why-now push, cooldown, consent block) | proven |
| Atomic claim so two schedulers never send twice | `claim_reminder(uuid)` SECURITY DEFINER: conditional `UPDATE … WHERE status='pending' OR stale 'sending'`, row_count = 1 | SQL definition read back | proven (compare-and-set, not `FOR UPDATE SKIP LOCKED`; same guarantee) |
| Party vs reminder templates | `evaluate-triggers` kind branch | dry run at the reminder's time: `Reminder: call mom (Fri 12:00 PM).`; scenario 3: party push with weekly remaining | proven |

## Cost and benchmarks (the spec's headline numbers)

| Claim | Evidence | Verdict |
|---|---|---|
| Heavy month under $4.50 | 35 turns $0.057–0.111 across runs; estimate $3.1 at the measured average, up to about $4.7 if every writer call is a cold cache; `SOUL_LIGHT_MODEL=haiku` halves it | holds for the heavy profile; cache-sensitive (see COST_MODEL.md) |
| Dots / Muse / Grok Bot level | blind pairwise: 55% vs Grok under the constitution judge, 60% vs a Dots-style reference under the generic judge, 17–43% elsewhere; no human rating | not demonstrated; see VOICE.md |

## Not in this audit

Push delivery to a device (APNs keys are placeholders), TestFlight, a human rating of the voice, and the local Supabase container (broken; cloud used throughout).
