# Clinical basis (US references)

Every coaching rule that touches a number, a threshold or a technique is tied to a published US source and implemented as code, not as model behaviour. The model never computes against these lines; code does, and the writer may name a crossed line once.

## Sources

| Source | What it gives the product |
|---|---|
| NIAAA, *Rethinking Drinking* and the NIAAA definitions page | Standard drink (14 g pure alcohol); low-risk drinking limits (men: no more than 4 drinks on any day and 14 a week; women: 3 and 7); binge drinking (5+ men / 4+ women in about two hours); heavy drinking day (more than 4 / 3) |
| US Preventive Services Task Force, 2018 recommendation on unhealthy alcohol use in adults | Screen all adults in primary care with a brief instrument and offer brief behavioral counseling to those who screen positive |
| AUDIT-C (Bush et al., *Arch Intern Med* 1998; VA/NIAAA cut-points) | Three-item screen; positive at 4+ for men and 3+ for women; 8+ is the band where the questionnaire alone points to a fuller assessment |
| SAMHSA TIP 35, *Enhancing Motivation for Change in Substance Use Disorder Treatment* (motivational interviewing) | Reflective listening, affirmations of effort, rolling with resistance, asking permission before giving advice (elicit-provide-elicit), eliciting the person's own reasons |
| Marlatt & Gordon, *Relapse Prevention* (and Marlatt & Donovan 2005) | A lapse is not a relapse (abstinence-violation effect); high-risk situations are planned for in advance with a concrete coping response |
| 988 Suicide & Crisis Lifeline; SAMHSA National Helpline 1-800-662-4357 | Fixed crisis text; withdrawal text points to a clinician, never to a taper |

## Where each rule lives

| Rule | Code | Test or check |
|---|---|---|
| Standard drink = 14 g; exact vs nominal labelled | `_shared/drinks.ts` | `drinks` SQL assertions; FAQ check in `eval/features.ts` |
| Sex-specific NIAAA thresholds; unknown sex applies the lower lines | `_shared/guidelines.ts` `thresholdsFor` | `guidelines_test.ts` |
| AUDIT-C scoring and bands | `guidelines.ts` `auditCScore`, `auditCBand`; iOS `Guidelines.swift`, `ScreeningView.swift` | `guidelines_test.ts`; XCUITest answers the three items |
| Screen taken once at onboarding, retakeable, shown in Settings | `profiles.audit_c_score / audit_c_answers / audit_c_at / sex_for_guidelines` (migration `20261101000100`) | iOS build |
| Binge-level pace and heavy drinking day route the turn to the strong writer | `soul.ts` `shouldEscalateToSonnet` reasons `binge`, `heavy_day` | `soul_test.ts`; features check "Binge-level pace … routes to the strong writer" |
| Crossed lines are facts in `<verified_ledger_state>`; the writer may cite them once, never lecture | `guidelines.ts` `renderGuidelineLines`; SOUL prompt section 3 | `soul_test.ts` render test; features check "no lecture words" |
| A chosen weekly limit above the low-risk line gets the published note in the receipt | `tools_exec.ts` `setGoal` + `goalNote` | features check "Limit above the NIAAA low-risk line" |
| MI: reflect, affirm effort, roll with resistance, ask before advising | SOUL prompt section 3 | `soul_test.ts` prompt test; features check "asks before advising" |
| Lapse ≠ relapse: a heavy night is one night's data | SOUL prompt sections 2 and 3 | tone transcript turns 18 and 19 |
| High-risk situation gets a stated coping plan, quoted in the pre-event nudge | AGENTS prompt (`remember` "Plan for <event>: …"); `events.ts` `planFor`; `evaluate-triggers` event_prep body | `events_test.ts`; features check "Pre-event nudge quotes the user's own plan" |
| Never diagnose, never print the score, never withdrawal or detox advice | SOUL prompt; `safety.ts` fixed cards | features checks on screening score and safety cards |

## What this is not

A screening score and a set of thresholds do not make the app a treatment. The fixed safety text and the screening wording have not been reviewed by a clinician; the AUDIT-C result is shown to the user as information and a prompt to talk to a doctor, nothing more. People who screen in the high band are still allowed to use the tracker because refusing them would remove the one tool they came for; the app tells them once that a doctor can say more.
