// Fixed safety text chosen by code, never generated. Works when the model is
// down or the spend breaker trips.

export type SafetyKind = "crisis" | "withdrawal" | "driving";

export interface SafetyHit {
  kind: SafetyKind;
  pattern: string;
}

const CRISIS = [
  /\b(suicid\w*|kill (myself|me)|end (it all|my life)|want to die|don'?t want to (live|be here)|self[- ]harm|hurt myself)\b/i,
  /\b(overdos\w*|od'?d|od'?ing|not breathing|unresponsive|won'?t wake up|passed out and|can'?t wake)\b/i,
  /\b(alcohol poisoning|blacking out and vomiting|seizure|seizing)\b/i,
];

const WITHDRAWAL = [
  /\b(cold turkey|quit(ting)? (drinking )?(today|now|tonight) .*(shak|sweat|tremb))\b/i,
  /\b(shak(es|ing|y)|tremors?|trembl\w*)\b.*\b(stop(ped)?|quit|haven'?t had|since|without)\b/i,
  /\b(stop(ped)?|quit|haven'?t had|since|without)\b.*\b(shak(es|ing|y)|tremors?|trembl\w*|sweat(s|ing)?|hallucinat\w*)\b/i,
  /\b(withdrawal|dts|delirium tremens|detox(ing)? (at home|myself|alone))\b/i,
  /\b(taper|how (do i|to) (stop|quit) (safely|drinking))\b.*\b(daily|every day|fifth|bottle|heavy)\b/i,
];

const DRIVING = [
  /\b(ok(ay)? to drive|safe to drive|can i drive|should i drive|drive home|am i (good|fine|ok) to drive)\b/i,
  /\b(my bac|blood alcohol|under the limit|over the limit|legal limit)\b/i,
  /\b(sober enough to drive|drive after)\b/i,
];

export function detectSafety(text: string): SafetyHit | null {
  for (const re of CRISIS) if (re.test(text)) return { kind: "crisis", pattern: re.source };
  for (const re of WITHDRAWAL) if (re.test(text)) return { kind: "withdrawal", pattern: re.source };
  for (const re of DRIVING) if (re.test(text)) return { kind: "driving", pattern: re.source };
  return null;
}

export const SAFETY_TEXT: Record<SafetyKind, string> = {
  crisis:
    "If you or someone with you is in immediate danger, call 911 now.\n\n" +
    "If you're having thoughts of harming yourself, call or text 988 (Suicide & Crisis Lifeline) any time, " +
    "or reach the SAMHSA National Helpline at 1-800-662-4357 (free, confidential, 24/7).\n\n" +
    "I'm a logging coach, not a crisis service. I'm here when you want to keep talking.",
  withdrawal:
    "Stopping suddenly after heavy daily drinking can be dangerous. Shaking, sweating, severe anxiety or confusion " +
    "after cutting back are signs to get medical care today, not to push through alone.\n\n" +
    "Please speak with a doctor or urgent care before stopping abruptly, or call the SAMHSA National Helpline at " +
    "1-800-662-4357 (free, 24/7). If symptoms are severe or someone is seizing or unresponsive, call 911.\n\n" +
    "I can't give taper schedules or detox plans. I can keep logging with you once you've talked to a clinician.",
  driving:
    "I can't estimate your blood alcohol or tell you it's safe to drive. If you've had anything tonight, " +
    "the safe call is a rideshare, transit, or a sober friend. Want me to log what you've had so far?",
};

export const CHECK_IN_TEXT =
  "That sounds like a lot to carry right now. If you're not safe or you feel physically unwell after cutting back, " +
  "please reach out: call or text 988, or the SAMHSA Helpline 1-800-662-4357 (free, 24/7); call 911 in an emergency.\n\n" +
  "I'm still here to keep logging with you.";

/** Paraphrase check for the model's own risk_flag: the matching fixed text, or a lighter check-in when no keyword hit. */
export function safetyTextForFlag(text: string): string {
  const hit = detectSafety(text);
  return hit ? SAFETY_TEXT[hit.kind] : CHECK_IN_TEXT;
}
