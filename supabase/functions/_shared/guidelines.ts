// US clinical basis for the code rules. Every threshold here is a published number, not a product choice:
// - Standard drink: 14 g pure alcohol (NIAAA; see drinks.ts).
// - Low-risk drinking (NIAAA): men no more than 4 drinks on any day and 14 a week; women no more than 3 on any day and 7 a week.
// - Binge drinking (NIAAA): 5 or more drinks (men) or 4 or more (women) in about two hours.
// - Heavy drinking day (NIAAA): more than 4 (men) or 3 (women) on one day.
// - Screening: USPSTF 2018 recommends screening all adults; AUDIT-C (Bush et al. 1998) positive at 4+ for men and 3+ for women;
//   8+ is the band where the questionnaire alone suggests a fuller assessment with a clinician.
// When sex is unknown the lower (women's) lines apply, which is the conservative reading.

export type GuidelineSex = "male" | "female" | null;

export interface Thresholds {
  perDay: number;
  perWeek: number;
  bingeIn2h: number;
  auditCPositive: number;
}

export const AUDIT_C_HIGH = 8;
export const AUDIT_C_MAX = 12;

export function thresholdsFor(sex: GuidelineSex): Thresholds {
  return sex === "male"
    ? { perDay: 4, perWeek: 14, bingeIn2h: 5, auditCPositive: 4 }
    : { perDay: 3, perWeek: 7, bingeIn2h: 4, auditCPositive: 3 };
}

/** The three AUDIT-C items, each answered 0 to 4. */
export function auditCScore(answers: [number, number, number]): number {
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > 4) throw new RangeError(`AUDIT-C answers are integers 0 to 4, got ${a}`);
  }
  return answers[0] + answers[1] + answers[2];
}

export type AuditCBand = "negative" | "positive" | "high";

export function auditCBand(score: number, sex: GuidelineSex): AuditCBand {
  if (score >= AUDIT_C_HIGH) return "high";
  return score >= thresholdsFor(sex).auditCPositive ? "positive" : "negative";
}

export interface GuidelineInput {
  sex: GuidelineSex;
  drinksLast2h: number;
  todayTotal: number | null;
  weeklyTotal: number;
  weeklyLimit: number;
}

export interface GuidelineFlags {
  binge: boolean;
  heavyDay: boolean;
  weekOverLowRisk: boolean;
  limitAboveLowRisk: boolean;
  thresholds: Thresholds;
}

/** Pure: which published lines the verified figures cross. */
export function guidelineFlags(i: GuidelineInput): GuidelineFlags {
  const t = thresholdsFor(i.sex);
  return {
    binge: i.drinksLast2h >= t.bingeIn2h,
    heavyDay: i.todayTotal != null && i.todayTotal > t.perDay,
    weekOverLowRisk: i.weeklyTotal > t.perWeek,
    limitAboveLowRisk: i.weeklyLimit > t.perWeek,
    thresholds: t,
  };
}

export interface Screening {
  score: number;
  band: AuditCBand;
}

/** Lines for <verified_ledger_state>: facts the writer may name once, never a lecture. */
export function renderGuidelineLines(f: GuidelineFlags, screening: Screening | null): string[] {
  const out: string[] = [];
  const t = f.thresholds;
  if (f.binge) out.push(`guideline: binge-level pace, ${t.bingeIn2h} drinks within two hours (NIAAA line for this user)`);
  if (f.heavyDay) out.push(`guideline: heavy drinking day, more than ${t.perDay} drinks today (NIAAA line for this user)`);
  if (f.weekOverLowRisk) out.push(`guideline: week is past the NIAAA low-risk line of ${t.perWeek} drinks`);
  if (screening) out.push(`screening: AUDIT-C ${screening.score}/${AUDIT_C_MAX} (${screening.band}) from onboarding; never diagnose, never repeat the clinician suggestion unless they ask`);
  return out;
}

/** Appended to the set_goal receipt when the chosen limit is above the published low-risk line. */
export function goalNote(limit: number, sex: GuidelineSex, lang: "zh" | "en"): string | null {
  const t = thresholdsFor(sex);
  if (limit <= t.perWeek) return null;
  return lang === "zh"
    ? `（NIAAA 低風險飲酒線是每週 ${t.perWeek} 杯。）`
    : `(The NIAAA low-risk line is ${t.perWeek} a week.)`;
}

/** Numbers the guard may accept when guideline lines are present. */
export function guidelineNumbers(f: GuidelineFlags, screening: Screening | null): number[] {
  const t = f.thresholds;
  const out = [t.perDay, t.perWeek, t.bingeIn2h, 2];
  if (screening) out.push(screening.score, AUDIT_C_MAX);
  return out;
}
