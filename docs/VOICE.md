# Coach voice

What a user should feel: a close, perceptive friend who texts back in one or two sentences, remembers what you told them, notices the moment (the hour, the pace, what is coming up) and never sounds like a receipt or a counselor. Since 2026-10-31 evening this is built as an AGENTS / SOUL split with post-DB state injection, the pattern used by 2026 always-on personal agents, so the words are written once, after the facts are known.

## Architectural and experience alignment with 2026 always-on personal agents

Benchmarks: OpenAI **Dots** (always-on personal agents on GPT-6 Astra, launched 2026-09-29), Meta **Muse** (Muse Spark models and Muse personal agents, from April 2026) and xAI **Grok Bot** (August 2026), with the open-source reference architectures **OpenClaw** (SOUL.md / AGENTS.md, dreaming consolidation) and **Hermes Agent**. SoberCoach implements four mechanisms from that family:

1. **AGENTS vs SOUL separation** (OpenClaw pattern). Tool execution, RLS and ledger math are isolated in deterministic code plus a small model that only returns `tool_calls`, `intent`, `clarify`, `risk_flag`. Warmth lives in a separate SOUL pass that runs after the commit with **post-DB state injection**: SQL recomputes `<verified_ledger_state>` and the writer sees the real figures, so there is no `{template_slot}` stitching and no blank checkmark after a typed message.
2. **Background dreaming memory consolidation** (OpenClaw dreaming, Dots read-only proactive notes). Every five typed turns a Haiku pass rewrites `profiles.soul_profile` (under 250 tokens: vibe and preferences, triggers and patterns, active arc, suggested next nudge) from the last fourteen days of totals, the user's own facts, upcoming events and the last twelve messages. The writer reads it every turn at zero added latency. Measured: nine passes over a 35-turn run for $0.003 in total; the user can read and clear it in Settings.
3. **Sentinel safety and gated heartbeats** (Muse-style external boundary). Crisis, withdrawal and driving signals are intercepted by regex before any model, and the model's own `risk_flag` is a second layer that also returns fixed text. The proactive path keeps its seven gates and atomic claiming, so the 15-minute heartbeat sends at most one push a day and three a week.
4. **Behavioral escalation** (Grok Bot routine handoff). Routine turns are written by Haiku 5.5; emotional and reflective turns, and logs that put the week over the limit, that are the second separate log within two hours, or that land between 23:00 and 04:00 local, are written by Sonnet 5.5 at low reasoning effort, within the shared cap of ten strong calls per user per day.

## The three layers that make the words

1. **SOUL_PROMPT** (`_shared/soul.ts`): role, micro-attunement rule (routine turns one short sentence or sentence plus question, 8 to 25 words; hard moments up to two sentences, 35 words), twelve do-this / not-that anchors, strict constraints (zero openers, one question, numerical honesty against the verified state, same language, no clock-time repetition).
2. **Post-generation guard** (`postProcessSoulReply`): strips openers in English and Chinese, removes sentences that paraphrase the receipt or re-list figures already on screen, removes only the sentence that carries an unverified figure, keeps one question, caps routine turns at two sentences, enforces the user's language. An unusable result falls back to a code-rendered warm line built from verified figures, never to silence.
3. **Memory and reads**: `remember` keeps the user's own facts (capped at 14); the dreamed profile adds grounded patterns; `get_summary` and `get_reminders` print their fact line by code and the writer adds only what stands out.

## How the voice is measured

`eval/tone.ts` drives a fixed 35-turn conversation (plain logs, corrections, a blackout, shame, a craving, 1 am insomnia, family pressure, anger at the coach, party planning, Chinese input, a closing) through the real hosted function and saves the transcript. Three judges then read it:

- **Rubric** (`eval/judge.ts`, Claude Sonnet 5.5): every coach line 1 to 5 on brevity, no restating, specific, warm without cheerleading, language, question discipline, plus cliché and moralizing flags. Since the rebuild the rubric gives no credit for silence (an empty reply after a log scores 2 on specific and warm), so its scores sit about half a point below the earlier 4.49 and the two are not comparable.
- **Blind pairwise** (`eval/pairwise.ts`, judge GPT-6.1 Sol, a different vendor from every writer, both presentation orders, only self-consistent verdicts count): against a Sonnet-written reference in three registers (`--style companion`, `--style dots` for continuity and subtle nudges in the manner of OpenAI Dots, `--style muse` for calm body-and-pacing attunement in the manner of Meta Muse), and against the real Grok transcript (`--ref eval/results/tone-grok-2026-10-31.json`, 29 turns, the free tier's limit).
- **Cost and latency** from the function's own ledger.

The judge is used only to iterate the prompt and guards, never to pick the production model.

## Results (deployed configuration, run v25, 2026-10-31 night)

Deployed: Haiku 5.5 tool pass; Sonnet 5.5 writer at low reasoning effort for every typed turn except greetings and thanks (Haiku); strong route for emotional, reflective and behavioral turns within the daily cap; routine logs are zero-question micro-callbacks; receipts for entry writes live in the card. 35 turns, $0.063, no errors.

| Rubric (strict, Sonnet 5.5) | Overall | Track A: coaching (15) | Track B: routine (20) | Clichés |
|---|---|---|---|---|
| v25 deployed | 4.06 | 4.23 | 3.93 | 1 |
| v19 (Sonnet for every writer call, receipts in the bubble) | 4.06 | | | 0 |
| v16 (Haiku light writer) | 3.94 | | | 2 |

Blind pairwise, GPT-6.1 Sol, both orders, self-consistent verdicts only. Two judges are reported side by side: the **generic** judge is asked which reply reads more like a great friend-coach; the **constitution** judge is given the product's own rules (no openers or emojis, no reflexive "how are you feeling?" after routine logs, grounded continuity, one question only on hard moments). Win-or-tie, with the two tracks in brackets (A = coaching turns, B = routine turns).

| Opponent | Generic judge | Constitution judge |
|---|---|---|
| Grok (real transcript, 29 turns) | 24% (A 38%, B 13%) | **55%** (A 54%, B 56%) |
| Dots-style reference (Sonnet-written, continuity and subtle nudges) | **60%** (A 67%, B 55%) | 40% (A 40%, B 40%) |
| Muse-style reference (Sonnet-written, body and pacing) | 43% (A 40%, B 45%) | 17% (A 13%, B 20%) |
| Companion reference (Sonnet-written, no style) | 37% (A 40%, B 35%) | 20% (A 20%, B 20%) |

How to read this honestly:

- **Noise first.** The same v21 transcript judged four times by the generic judge against the same companion reference scored 29%, 31%, 40% and 46%. With 29 to 35 turns, differences under about fifteen points are not differences.
- **Against the real product (Grok)** the picture flips with the judge. The generic judge rewards Grok's "Got it — 3 toward your 8. How are you feeling? 🔥" after every log; told the product's rules, the same judge prefers the deployed coach on both tracks. That is the trade-off the spec makes on purpose: a reflexive check-in after every drink becomes notification fatigue by the second week, and the coach refuses it.
- **Against Sonnet-written references** the constitution judge does not help, because those references already obey the rules and are written with hindsight by a model that is at least as strong as the writer. The deployed coach beats the Dots-style reference under the generic judge (60%, and 67% on coaching turns) and loses to the Muse-style one under both.
- **The 75% target was not reached** under any judge against any opponent. What did move: zero clichés in most runs, question discipline 4.94, brevity 4.23, routine-turn fallbacks eliminated after the receipt-in-card fix, and a run cost of $0.063.
- Earlier configurations: Haiku as light writer 31% to 34% vs Grok (generic); Flash-Lite unusable (reasoning cannot be disabled on its ZDR endpoint); Sonnet for every writer call 41% vs Grok (generic) at $0.111.

Transcripts, judge files and per-turn verdicts: `eval/results/tone-v25-*.json`, `.judge.json`, `.vs-grok.{generic,constitution}.txt`, `.pairwise-{companion,dots,muse}.{generic,constitution}.txt`. Rerun: `make tone LABEL=x`, then `deno run -A eval/pairwise.ts <transcript> --ref eval/results/tone-grok-2026-10-31.json --judge constitution` and `--style dots|muse|companion`.

## Language

The model mirrors the user's language by rule. Code-rendered lines (confirmations, pace label, summary line, limit banner, the standard-drink fact) switch to Traditional Chinese when the message contains CJK characters, so a Chinese conversation reads as one voice rather than Chinese commentary under English receipts.

## Still open

- No human has rated the coach yet; every score above is a model judging a model. The simulator session tonight is the first human read.
- The 29-turn Grok transcript is one run on the free tier; six turns of the script were never answered by Grok.
- Dots and Muse are reproduced as style references, not driven as products; Dots has no public API and Muse runs inside Meta's apps.
- Cost is sensitive to prompt-cache hits: a cold Sonnet writer call is $0.005 to $0.007, a warm one about $0.002. `SOUL_LIGHT_MODEL=anthropic/claude-haiku-5.5` halves the bill at a visible cost in warmth.
- Safety text is US-centric (911, 988, SAMHSA); a Traditional Chinese user should see 1925 (安心專線) and 119.
