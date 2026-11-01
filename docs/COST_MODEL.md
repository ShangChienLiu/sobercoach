# Cost model

Budget per heavy user-month: $4.50, covering model calls plus a $0.50 infrastructure share. Budgeted without counting on prompt caching; caching is upside measured by `messages.tokens_cached`.

## Inputs

| Input | Value | Source |
|---|---|---|
| Heavy use | 30 free-text messages a day, 900 a month | Spec assumption; quick-log taps are extra and cost $0 |
| Stress case | 3,000 messages a month | Spec |
| Small call | 1,500 tokens in, 200 out, Haiku 5.5 at the live OpenRouter list price ($0.10/M in, $0.50/M out, read 2026-10-31) → $0.00025 uncached per call | `_shared/pricing.ts`; OpenRouter's reported `usage.cost` on the first real calls was $0.00048 for a 2,000-token prompt, in line with this |
| Strong decision call | Sonnet 5.5 $2.00/M in, $10.00/M out at low effort: a multi-entry edit measured $0.018 for the whole turn (decision pass plus writer) on 2026-11-01, $0.024 before effort was set. Flash-Lite ($0.0012 a turn) held this slot until 2026-11-01; see DECISION_RECORD | Live list prices plus measured turns |
| Escalation | 15% of messages (budget), measured by ledger | Spec |
| Strong cap | 10 strong attempts per user per day (decision retries and strong-writer turns) | `STRONG_CALLS_PER_USER_PER_DAY` |
| User budget | $0.15 of model spend per user per service day; past it the writer drops to the budget model (Haiku) and nothing escalates. 30 × $0.15 = $4.50, the spec ceiling | `USER_MODEL_BUDGET_USD_PER_DAY`, `SOUL_BUDGET_MODEL`; `ledger_user_spend_since` summed in SQL, fails closed |
| Extras | 30 reminder drafts, 4 memory summaries, 10% retry reserve, 5.5% OpenRouter fee | Spec |

## Where the ceiling lands

| Profile | Model cost | + infra | Budgeted |
|---|---|---|---|
| 900 msgs, 15% to Flash-Lite, small uncached at live list price ($0.00025) | 900 × $0.00025 + 135 × $0.0049 = $0.89 → ×1.10 retry ×1.055 fee = $1.03 | $0.50 | $1.53 |
| 900 msgs, 15% to Flash-Lite, small at the measured $0.00048 (2,000-token prompt) | $0.43 + $0.66 = $1.09 → $1.27 | $0.50 | $1.77 |
| 3,000 msgs, cap hit daily (300 strong), Flash-Lite | $0.75 + $1.47 = $2.22 → $2.58 | $0.50 | $3.08 |
| 3,000 msgs, cap hit daily, every strong call falls to Sonnet 5.5 | $0.75 + $2.40 = $3.15 → $3.66 | $0.50 | $4.16 |

With live prices the small tier is cheap enough that caching is not needed to stay under budget; the strong tier dominates. Two levers still matter:

1. **Fast path share.** Every turn the regex handles is $0. The ledger's `tier0_fastpath` share replaces the 20% assumption.
2. **Context size.** The volatile context is about 400 tokens; the cached system prompt and schema are about 1,100. If `tokens_cached` stays near zero in production, trim the schema description text or move to a prompt-caching-friendly provider pin.

The spend breaker (`GLOBAL_DAILY_SPEND_USD`) and the per-user strong cap bound the worst case regardless.

## Deployed configuration (AGENTS / SOUL split, 2026-10-31 night)

Every typed turn now has two model calls: a Haiku 5.5 tool pass (about $0.0003 to $0.0007 with the 1,500-token context) and a plain-text SOUL pass that writes the words after the commit. The regex fast path skips the tool pass. Button actions skip both.

| Writer configuration (35-turn tone run, hosted) | Measured | Notes |
|---|---|---|
| Haiku 5.5 light writer, Sonnet 5.5 for emotional, reflective and behavioral turns | $0.052 to $0.059 | rubric 3.84 to 3.94 on the strict rubric; the light writer paraphrases receipts |
| Gemini 3.5 Flash-Lite light writer | $0.055 | unusable: the ZDR endpoint rejects `reasoning: off` (400), so 21 of 35 turns fell to code lines; fixed by `reasoningFor()` but not re-measured |
| Sonnet 5.5 for every writer call, low reasoning effort | $0.111 | rubric 4.06, 0 clichés |
| Sonnet 5.5 writer, Haiku for small talk (deployed) | $0.078 to $0.097 | rubric 3.86 to 4.00; receipts moved into the card |
| Dreaming pass | $0.003 per 35 turns | nine Haiku consolidations, about $0.0003 each |

Per-turn Sonnet writer cost is $0.002 to $0.008 depending on prompt-cache hits on the SOUL prompt (about 1,300 tokens) and on the output length (one or two sentences, up to 500 tokens allowed with low effort spending zero reasoning tokens).

| Profile | Model cost | + infra | Budgeted |
|---|---|---|---|
| 900 msgs, deployed config at the measured average $0.0025 per turn (tool pass + writer, dream included) | 900 × $0.0025 = $2.25 → ×1.10 retry ×1.055 fee = $2.61 | $0.50 | **$3.11** |
| 900 msgs, Haiku light writer (cheapest usable) | 900 × $0.0016 = $1.44 → $1.67 | $0.50 | $2.17 |
| 3,000 msgs, deployed config, no user budget | $7.50 → $8.70 | $0.50 | $9.20 |
| 3,000 msgs with the $0.15 daily user budget (from 2026-11-01) | at most 30 × $0.15 = $4.50 of model spend, the rest of the day on the Haiku budget writer | $0.50 | **$5.00 hard bound**; the heavy profile never reaches the budget ($0.075 a day at the measured average) |

The spec's $4.50 ceiling holds for the heavy profile on the measured average. The stress profile is now bounded by the per-user daily budget rather than by hope: once a user has spent $0.15 in a service day, routine and hard turns alike are written by `SOUL_BUDGET_MODEL` (Haiku) and no decision retry or strong-writer escalation fires until the next service day. Verified live on 2026-11-01 by setting the budget to $0.000001: a four-beer log came back `soul:light:budget` on Haiku, a multi-entry edit `preflight_multi_entry+budget_capped`; restored to $0.15 the same turns went `soul:strong` and `strong_call` on Sonnet.

## What the ledger records per message

`tier`, `model`, `route_reason`, `tokens_in`, `tokens_cached`, `tokens_out`, `cost_usd` (OpenRouter's reported cost when present, else the price table), `latency_ms`, `risk_flag`, `tool_calls`. The Reviewer Sandbox shows the running totals; `eval/run.ts` reports cost per model call and p50/p95 latency per tier.
