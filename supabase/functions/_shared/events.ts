// Standing intents: a future event is either a drinking occasion (party, dinner, bar)
// or a general reminder (call mom, don't buy beer). The model extracts atomic,
// nullable fields (date, time, days_from_now); code applies the business defaults
// and decides the kind, so a small model never has to guess a time to act.

import { addDays, instantAtLocal, isoDate, localParts } from "./service_day.ts";

export type EventKind = "drinking_social" | "general_reminder";

const REMINDER_CUE = /\b(remind|reminder|notify|notification|ping|alert|nudge|don'?t (buy|drink|forget)|call|text|pick ?up|appointment|meeting|doctor|dentist|gym|pay|bill|take (my|the) (meds|pills))\b|提醒|通知|別忘|不要(買|喝)|打給|看醫生|開會/i;
const SOCIAL_CUE = /\b(party|dinner|drinks?|bar|pub|wedding|bbq|barbecue|birthday|brunch|happy hour|night out|going out|celebration|reunion|game night|tailgate|festival|concert|club)\b|聚餐|聚會|婚禮|喝酒|派對|酒吧|生日|同學會|尾牙|春酒|慶功/i;

/** Which template this intent belongs to, from the user's words and the saved title. */
export function eventKindFor(userMessage: string, title: string): EventKind {
  const text = `${userMessage} ${title}`;
  if (SOCIAL_CUE.test(text)) return "drinking_social";
  if (REMINDER_CUE.test(text)) return "general_reminder";
  return "drinking_social";
}

/** Business defaults when the user named a day but no time. */
export function defaultHourFor(kind: EventKind): number {
  return kind === "general_reminder" ? 12 : 20;
}

export interface EventTimeInput {
  date: string | null; // YYYY-MM-DD in the user's timezone
  time: string | null; // HH:MM
  daysFromNow: number | null;
  kind: EventKind;
  now: Date;
  tz: string;
}

/** Deterministic resolution of the model's atomic fields to an instant. */
export function resolveEventDateTime(i: EventTimeInput): Date {
  const dateOk = i.date && /^\d{4}-\d{2}-\d{2}$/.test(i.date) ? i.date : null;
  const lp = localParts(i.now, i.tz);
  const today = isoDate(lp.year, lp.month, lp.day);
  const day = dateOk ?? addDays(today, i.daysFromNow ?? 0);
  const m = i.time ? /^(\d{1,2}):(\d{2})$/.exec(i.time) : null;
  const hour = m ? Math.min(23, Number(m[1])) : defaultHourFor(i.kind);
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  return instantAtLocal(day, hour, minute, i.tz);
}

/** Lead time before the event when the nudge goes out. */
export const EVENT_PREP_LEAD_MS = 3 * 60 * 60 * 1000;
export function nudgeAt(startsAt: Date, kind: EventKind): Date {
  return kind === "general_reminder" ? startsAt : new Date(startsAt.getTime() - EVENT_PREP_LEAD_MS);
}
