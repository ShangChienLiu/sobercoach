# Decision record

Measured results replace the estimates in the architecture spec. Fill the tables from `eval/results/*.md` and the `messages` ledger; leave a cell blank rather than estimate it.

## Model picks

| Tier | Starting pick (τ²-Bench, 2026-10-30) | Challenger | Rule for the final call |
|---|---|---|---|
| Small | Claude Haiku 5.5 | GPT-6 Luna | Highest state accuracy on correction and date scenarios (1, 2, 6, 7), then lowest escalation rate. Must reach 95% on corrections or corrections route to strong. |
| Strong | Gemini 3.5 Flash-Lite | Claude Sonnet 5.5 | Blind human rating of scenario 8 answers; cheapest within 5% of the best wins. |
| Strong fallback | Claude Sonnet 5.5 | — | Fires only on error, rate limit or downtime of the primary. |

Any hard failure on a safety (10) or data-isolation (9) scenario drops a model regardless of other scores.

## Results

Run: `deno run -A eval/run.ts --runs 3 --paraphrases --label <model>` once per candidate with `SMALL_MODEL` / `STRONG_MODEL` set in `supabase/.env`.

| Candidate | Tier | State accuracy | Correction accuracy (S1, S2, S7) | Escalation rate | Unsafe replies | p50 ms | p95 ms | Cost per model call | Cache hit tokens |
|---|---|---|---|---|---|---|---|---|---|
| **claude-haiku-5.5** small + gemini-3.5-flash-lite strong (3 runs × paraphrases, local stack, 2026-10-31) | small | **330/330 (100%)** | 138/138 | 42 strong of 201 calls (21%, incl. scenario 12's cap test) | 0 | small 2,558 · strong 6,713 | small 4,229 · strong 7,355 | $0.00076 (OpenRouter reported) | 0 |
| openai/gpt-6-luna small + gemini-3.5-flash-lite strong | small | 330/330 (100%) | 138/138 | 42 of 201 (21%) | 0 | small 4,150 · strong 6,665 | small 5,805 · strong 7,280 | $0.00068 | 0 |
| claude-haiku-5.5 small + **claude-sonnet-5.5** strong | strong | 324/332 (98%); all 8 misses were two HTTP 502s from the local edge gateway on long strong turns in scenario 8, not model output | 138/138 | 40 of 199 | 0 | small 2,490 · strong 5,323 | small 4,105 · strong 6,400 | $0.00220 (about 3× the Flash-Lite pairing) | 0 |
| mock gateway (orchestration only) | both | 330/330 | 138/138 | 21% | 0 | 17–25 | 27–31 | n/a | n/a |

### Verdict (per the selection rules in the spec)

- **Small tier: Claude Haiku 5.5.** Both candidates reached 100% state accuracy and the same escalation rate, so the tie goes to p95 latency: 4.2 s versus 5.8 s. Cost per call differs by $0.00008, which price only breaks after quality.
- **Strong tier: Gemini 3.5 Flash-Lite**, with Sonnet 5.5 as fallback. Flash-Lite completed every scenario; Sonnet's only misses were transport errors. The blind human rating of scenario 8 answers is still open and could overturn this if Sonnet's reflections read materially better; the two sets of answers are in `eval/results/haiku55-*.json`.
- Caching: `tokens_cached` was 0 on every real call, so the budget keeps assuming no cache.
- Measured real cost per model call ($0.0007–0.0008) is under the spec's per-call budget, and the strong share in the suite (21%) is above the 15% budget only because scenario 12 deliberately fires 40 reflection turns.

Share of turns handled by the Tier-0 fast path: 51 of 267 harness turns (19%) in every run; the scenario mix is not real traffic, so this only shows the path works.

## Decisions taken in the build that the spec left open

| Decision | Choice | Why |
|---|---|---|
| Ambiguous correction target | Code detects it before any model call and returns tappable choices ($0, nothing written) | Cheaper and more reliable than asking a model to notice ambiguity; the spec's "ask one question" behavior is preserved |
| Tool-call format | One strict JSON envelope (`tool_calls[]`, `post_commit_reply`, `clarify`, `risk_flag`) via `response_format: json_schema` | Works across vendors on OpenRouter, keeps the single pass, and lets every write be validated before code runs it |
| Undo semantics | Undo of a corrected entry restores the previous snapshot; undo of a fresh entry sets `status = undone` | "Actually it was 2" then Undo should give back 3, not delete the beer |
| Relative day of a log | `last_night` before the rollover hour means the ongoing night; `yesterday` is always the current service day minus one | Matches how people talk at 01:30 |
| Push without APNs | Row is still marked sent so dedupe and caps behave; the app mirrors it as a local notification carrying the same "Stop these" action | Lets a reviewer on a simulator test consent flipping |
| Blocked by quiet hours | Row stays `pending` and is retried on the next tick; other gates are final | A reminder delayed past quiet hours is still useful; a reminder the user declined is not |
| Strong fallback for the small tier | The small route lists the strong model as its network fallback | A small-model outage degrades to a better answer at higher cost rather than to no answer |
| Strong cap counts attempts | Every strong call appends a `strong_call` marker to `route_reason`; the cap and ledger count the marker, so a failed or invalid strong response still spends one of the 10 | Found in review: counting only successful strong rows let a user with persistently invalid small output trigger unlimited strong calls |
| Fail closed | A failed cap query reads as capped; a failed spend query trips the breaker (chat degrades to Tier-0); a failed gate query leaves the push pending | A missed reminder or a plainer answer costs less than an unwanted push or runaway spend |
| Send claim | `claim_reminder()` flips a row to `sending` atomically before APNs; stale claims (10 min) can be retaken | Overlapping cron and debug ticks could otherwise double-send |
| Partial tool failure | Any failed tool drops the model's line and states what was not written | A success-sounding reply after a half-applied change is the exact failure mode the spec forbids |
| Time simulator scope | `simulated_now` and `force_apns` honored only when `profiles.is_test` and `ENVIRONMENT != production` | A debug path that can make pushes fire is production-gated server-side, not in the app |

## Findings from the first real-model runs

- Haiku 5.5 handled every correction and relative-date scenario once the output cap was raised: the strict envelope repeats all 14 arg keys per tool call, so 300 output tokens truncated the JSON. Caps are now 900 (small) and 1,200 (strong), and a truncated completion is surfaced as `finish_reason=length` instead of a JSON parse error.
- `temperature` plus `require_parameters` left no ZDR endpoint for Claude 5.5 models; the request no longer sends temperature.
- Anthropic's Vertex and Bedrock endpoints reject JSON schemas with more than 16 union-typed parameters; the envelope now uses shared `text` and `flag` slots (15 unions), guarded by a unit test.
- Cache hits were 0 on every call measured so far, which supports budgeting without caching.
- Real latency: about 2.5 s p50 for a small turn and 6.5 s for a strong turn. The Tier-0 paths stay under 30 ms, which is why the fast path and quick-log buttons matter for feel.

## Hosted verification (hosted project, Tokyo, 2026-10-31 evening)

- Chat scenarios 1, 2, 6–12 with paraphrases: all checks pass on the hosted functions with the real models after the voice rewrite.
- Trigger scenarios 3, 4, 5: 23/23 once `ENVIRONMENT` was set to `demo` (the time simulator is refused under `production`; test accounts remain the gate).
- Voice: see `docs/VOICE.md`; an 18-turn conversation costs about $0.01.

## Rebuild as AGENTS / SOUL with post-DB state injection (2026-10-31 night)

Superseded: the placeholder scheme (`{weekly_remaining}` slots filled by code), silence after typed logs, the 28-word voice-pass cut-off, and the second "summary follow-up" model pass. What replaced them, and why:

- **The small model only decides.** `coach_turn` now returns `tool_calls`, `intent`, `clarify`, `risk_flag`; no reply text. Haiku 5.5 is reliable at tool selection and state (330/330 mock, 41/41 hosted) and poor at warmth, so it stopped writing.
- **Words come after the commit, with real figures.** SQL recomputes `<verified_ledger_state>` (signed weekly remaining, today, separate logs in the last two hours, local hour, next event countdown) and the writer sees it. The guard then removes only a sentence that carries a figure outside that state or the user's own words; it never blanks a reply over a digit.
- **Typed messages always get words; buttons stay receipt-only.** The code receipt for a typed turn lives in the entry card (count, drink, service day, Undo) and in the ledger, so the bubble reads as one voice. Fact lines (summary, reminders) stay in front of the words because they are the answer.
- **Behavioral escalation.** Beyond emotional and reflective intents, a log that puts the week over the limit, a second separate log within two hours, or a log between 23:00 and 04:00 is written by the strong writer. The daily cap of ten counts those calls.
- **Dreaming pass.** Every five typed turns, Haiku rewrites `profiles.soul_profile` from the raw record; nine passes over a 35-turn run cost $0.003 and produced a profile that named Fridays, the 4 a.m. wake-ups and the brother without being told to.

Writer choice, measured on the strict rubric (no silence credit, so not comparable with the 4.49 of the placeholder design):

| Light writer | Rubric | Clichés | vs Grok (29 turns) | 35-turn cost |
|---|---|---|---|---|
| Haiku 5.5 | 3.84 to 3.94 | 0 to 2 | 31% to 34% | $0.052 to $0.059 |
| Gemini 3.5 Flash-Lite | 3.77 (21 fallbacks) | 10 (fallback lines) | 17% | $0.055 |
| Sonnet 5.5 (low effort), all turns | 4.06 | 0 | 41% | $0.111 |
| Sonnet 5.5, Haiku for small talk, receipts in card (deployed) | 3.86 to 4.00 | 0 | 34% | $0.078 to $0.097 |

Reading: Sonnet as the writer is the only configuration with zero clichés and the best rubric; Haiku costs half and reads like a tracker on routine turns. Run-to-run noise on the 29-turn Grok comparison is about ±7 points, so 34% and 41% are the same number. The GPT-6.1 Sol judge prefers Grok's "Got it — 3 toward your 8. How are you feeling?" with emojis and praise on routine logs, which the spec's constraints forbid; on hard moments (blackout, craving, insomnia, family pressure, planning) the deployed coach wins most turns. Dots-style reference: 51% win-or-tie (v16).

## Against named products

Earlier text here said Dot had shut down and Muse could not be found; that referred to New Computer's Dot and was the wrong product. The benchmarks are OpenAI Dots (always-on agents, 2026-09-29), Meta Muse (Muse Spark, April 2026) and xAI Grok Bot (August 2026). Grok was driven directly through grok.com (29 answered turns before the free tier limit); Dots and Muse are reproduced as style references written by Sonnet 5.5 from their published positioning, judged blind by GPT-6.1 Sol. Results and caveats in `docs/VOICE.md`.

## Open hypotheses

- Trigger timings: 3 h before an event, 10:00 the morning after, 21:00 for two quiet days.
- Caching: Anthropic's 5-minute TTL and per-model minimum prefix mean most of a heavy user's 30 daily turns may hit a cold cache; `tokens_cached` in the ledger measures it.
- Escalation rate: budgeted at 15% of messages; the ledger's `tier = 'strong'` share replaces it.

## Routing revision: two models, a real budget (2026-11-01 afternoon)

Prompted by a review question: why was the cheap Flash-Lite in the "strong" slot and capped at 10 a day, while the expensive Sonnet writer ran on every typed turn with no per-user limit? Survey of how Grok Bot, Muse, dots, OpenClaw, Hermes and the routing literature handle this: `docs/MODEL_ROUTING_FIELD.md`.

| Change | Before | After | Evidence |
|---|---|---|---|
| Strong decision model | Gemini 3.5 Flash-Lite, chosen on τ²-Bench and a bakeoff that only measured state accuracy (both candidates passed); the planned human rating of its answers never happened; after the SOUL rebuild it only retried at most 10 tool decisions a day | Claude Sonnet 5.5 at low effort, Haiku 5.5 as network fallback. Two models in production instead of three | Live multi-entry edit ("actually the first beer was 2 and the last one was 3"): `preflight_multi_entry+strong_call` on Sonnet, both entries fixed; whole turn $0.018 (was $0.024 before effort was set on the structured call; Flash-Lite did this for about $0.001). At the cap of 10 that is at most $0.10 a day for a user who hits it, and the budget below stops it earlier |
| Per-user cost bound | Only the 10-a-day strong cap, which did not touch the Sonnet light writer; stress profile modelled at $9.20 a month | `USER_MODEL_BUDGET_USD_PER_DAY` = $0.15 summed from the ledger since the service day started (`ledger_user_spend_since`, fails closed). Over it: writer = `SOUL_BUDGET_MODEL` (Haiku), no decision retry, no strong writer; words still come | Live trip with the budget at $0.000001: "had 4 beers tonight at Dan's, feeling rough" → `soul:light:budget` on Haiku with a complete reply; the multi-entry edit → `preflight_multi_entry+budget_capped+clarify`. Restored to $0.15: `soul:strong:emotional` and `strong_call` on Sonnet. Stress profile now bounded at $5.00 a month including infra |
| Routine vs strong writer | Same model, same effort, same token budget; the difference was only the prompt's reason label and the cap count | `writerPlan()` returns model, effort and token budget per route: strong = `SOUL_MODEL` at `SOUL_STRONG_REASONING` (low, medium allowed) and 1,400 tokens; routine = `SOUL_LIGHT_MODEL` at low and 700 tokens; small talk = `SOUL_CHAT_MODEL`; budget = Haiku, effort off, 400 tokens. Chains never repeat a model | 79 / 79 Deno tests (6 new: defaults and chains, spend RPC wrapper incl. fail-closed, budget routing, writer plan); `eval/features.ts` on the deployed build, see VERIFICATION |

Honest notes. The hosted project keeps `SOUL_LIGHT_MODEL` on Sonnet, so routine and strong turns still share a model until a user crosses the budget; the cheap path is budget-driven, not per-turn, because the Haiku light writer measured 3.84 to 3.94 on the rubric against 4.00 to 4.06 for Sonnet and we chose not to lower voice quality silently. `SOUL_STRONG_REASONING=medium` is wired but not measured. The Sonnet decision pass is about ten times Flash-Lite's price per call; it was accepted because the slot fires rarely (preflight multi-entry edits, invalid envelopes, explicit escalate) and the budget bounds it.

## search_history: lookup over the user's own earlier messages (2026-11-01 evening)

Question that prompted it: do Grok Bot, Muse and dots keep a vector database over past chats? Survey in `docs/MEMORY_FIELD.md`: none of them documents one; they store model-written notes and files, and the only retrieval feature any of them admits to is Claude's on-demand "search past chats" tool. SoberCoach had the notes side (14 stated facts, the dreamed profile) but no lookup, so "what did I say about Dan's?" depended on the profile happening to contain it.

| Decision | Choice | Why |
|---|---|---|
| Mechanism | SQL function `search_messages`: case-insensitive substring per term over the user's own `messages` rows, 180 days, ranked by terms matched then recency, five hits; RLS-scoped (`security invoker`), so a user can only search their own rows | Works for Chinese without an extension (pg_trgm is unreliable for CJK; pgroonga is available on Supabase if volume ever demands it); nothing to keep in sync with the ledger; per-user volumes make the scan milliseconds |
| What is searched | The user's own statements only: coach lines are excluded (they would echo earlier search results, which happened in the first live probe) and so are the user's questions to the coach (`?` or `？` at the end) | The point is quoting the user's words, never the coach's paraphrase |
| What each hit carries | Date, snippet (140 chars) and that service day's logged total from `drink_entries` | The fact line the writer sees is fully verified, so the digit guard allows it and the coach can say "that night you logged 4" |
| Who decides to search | The AGENTS model (Haiku) with `search_history {text:"1 to 3 of their words"}`; code strips English filler words; intent `query` | Same tool discipline as `get_summary`: a visible tool call in the ledger, never a silent retrieval; the prompt says "never invent a memory" |
| No embeddings | None | Research found no consumer agent using them for memory, and Letta's filesystem result (grep over transcripts beating a vector memory) says the retrieval call matters more than the mechanism |

Evidence: SQL assertions in `supabase/tests/schema_test.sql` (best match first, current message excluded, other users never appear, CJK substring matches, day total carried); 5 Deno tests (`history_test.ts`); live probe on the hosted build as Alex: "what did I say about Dan's?" → tool call `search_history {text:"Dan's"}`, reply "Earlier about "dan's": Nov 1 (you): "had 4 beers tonight at Dan's, feeling rough" [logged 12.0 that day] Rough was your word for it that night. How does tonight feel by comparison?"; the Chinese form returned the same hit rendered in Chinese; "did I ever mention a wedding?" → "Nothing earlier about "wedding" in our chats." A search turn costs about $0.007 to $0.012 (Haiku tool pass, Sonnet writer, fact line in the prompt).
