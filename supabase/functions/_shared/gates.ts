// Send gates for proactive pushes. Checked at schedule time and again at
// send time. Any failed gate means no push. Pure.

import { inQuietHours } from "./service_day.ts";

export type TriggerKind = "event_prep" | "morning_after" | "missed_log";

export interface GateInput {
  now: Date;
  tz: string;
  quietStart: number;
  quietEnd: number;
  consentEnabled: boolean;
  apnsTokenPresent: boolean;
  pushesSentToday: number;
  pushesSentThisWeek: number;
  eventStillActive: boolean; // true for non-event triggers
  scheduledFor: Date;
  lastMissedLogSentAt: Date | null; // for the 3-day cooldown
  openedAppToday: boolean; // missed_log only
  trigger: TriggerKind;
}

export type GateName =
  | "CONSENT"
  | "APNS_TOKEN"
  | "QUIET_HOURS"
  | "DAILY_CAP"
  | "WEEKLY_CAP"
  | "EVENT_EXISTS"
  | "STALE"
  | "COOLDOWN"
  | "OPENED_TODAY";

export interface GateResult {
  gate: GateName;
  passed: boolean;
  detail: string;
}

export interface GateTrace {
  allowed: boolean;
  blockedBy: GateName | null;
  results: GateResult[];
}

export const MAX_PUSH_PER_DAY = 1;
export const MAX_PUSH_PER_WEEK = 3;
export const STALE_AFTER_MS = 60 * 60 * 1000; // 1 h
export const MISSED_LOG_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

export function evaluateGates(input: GateInput): GateTrace {
  const results: GateResult[] = [];
  const push = (gate: GateName, passed: boolean, detail: string) => results.push({ gate, passed, detail });

  push("CONSENT", input.consentEnabled, input.consentEnabled ? "category enabled" : "category disabled by user");
  push("APNS_TOKEN", input.apnsTokenPresent, input.apnsTokenPresent ? "device token present" : "no device token");

  const quiet = inQuietHours(input.now, input.tz, input.quietStart, input.quietEnd);
  push("QUIET_HOURS", !quiet, quiet ? `inside quiet hours ${input.quietStart}:00-${input.quietEnd}:00` : "outside quiet hours");

  push("DAILY_CAP", input.pushesSentToday < MAX_PUSH_PER_DAY, `${input.pushesSentToday}/${MAX_PUSH_PER_DAY} sent today`);
  push("WEEKLY_CAP", input.pushesSentThisWeek < MAX_PUSH_PER_WEEK, `${input.pushesSentThisWeek}/${MAX_PUSH_PER_WEEK} sent this week`);
  push("EVENT_EXISTS", input.eventStillActive, input.eventStillActive ? "event active" : "event cancelled or deleted");

  const staleMs = input.now.getTime() - input.scheduledFor.getTime();
  const stale = staleMs > STALE_AFTER_MS;
  push("STALE", !stale, stale ? `scheduled ${Math.round(staleMs / 60000)} min ago` : "fresh");

  if (input.trigger === "missed_log") {
    const sinceLast = input.lastMissedLogSentAt ? input.now.getTime() - input.lastMissedLogSentAt.getTime() : Infinity;
    const cooled = sinceLast >= MISSED_LOG_COOLDOWN_MS;
    push("COOLDOWN", cooled, cooled ? "cooldown elapsed" : `last missed-log push ${Math.round(sinceLast / 3600000)} h ago`);
    push("OPENED_TODAY", !input.openedAppToday, input.openedAppToday ? "user opened app today" : "no open today");
  }

  const firstFail = results.find((r) => !r.passed);
  return { allowed: !firstFail, blockedBy: firstFail?.gate ?? null, results };
}

export function blockedCode(trace: GateTrace): string | null {
  return trace.blockedBy ? `BLOCKED_BY_${trace.blockedBy}` : null;
}
