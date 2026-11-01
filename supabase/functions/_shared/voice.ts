// Voice guards: code-side checks that keep the coach terse and non-repetitive.

/** True when the model's line only repeats what the confirmation line already says. */
export function restatesTheWrite(reply: string): boolean {
  const t = reply.toLowerCase();
  const verbs = /\b(logged|i'?ve logged|i logged|updated|i'?ve updated|saved|i'?ve saved|recorded|i'?ve recorded|added|i'?ve added|set (that|it|the reminder)|setting (a|the) reminder|changed (it|that)|moved (it|that)|restored|removed|turned (off|on)|reminders? (are|is) (back )?(on|off)|i'?ll remind)\b/;
  const fillers = /\b(keep (it|that) up|great job|nice work|good job|take care|stay safe|have fun|let me know|i'?m here|you'?ve got this|got it|sure thing|no problem|you'?re welcome)\b/;
  return verbs.test(t) || fillers.test(t);
}

/**
 * When code already printed the figures (summary or reminder line), sentences
 * that would only repeat them through number placeholders are removed.
 */
export function dropNumberSentences(template: string): string {
  const numeric = /\{(weekly_total|weekly_remaining|weekly_limit|today_total|logged_count|logged_date|event_title|event_when)\}/;
  return template
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !numeric.test(sentence))
    .join(" ")
    .trim();
}

/** True when the user is asking about figures, so number placeholders are welcome. */
export function asksForNumbers(userMessage: string): boolean {
  return /\b(week|limit|total|how (much|many)|left|pace|count|so far|track|doing)\b/i.test(userMessage);
}

/** After an event write, sentences that echo the event (its title or "noted") are removed. */
export function dropEventEcho(template: string, title: string | null): string {
  const key = (title ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return template
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      if (/\bnoted\b/.test(lower)) return false;
      return !key.some((w) => lower.includes(w));
    })
    .join(" ")
    .trim();
}
