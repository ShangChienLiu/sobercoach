// Service-day math. A "service day" starts at rollover_hour local time, so a
// drink at 01:30 Saturday belongs to Friday. All functions are pure.

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  weekday: string; // "Fri"
}

const partFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    partFormatterCache.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** ISO date string (YYYY-MM-DD) for a Y/M/D triple. */
export function isoDate(y: number, m: number, d: number): string {
  // Date.UTC normalizes overflow (e.g. day 0 -> last day of previous month).
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(y, m, d + days);
}

/** The service date an instant belongs to, given tz and rollover hour. */
export function serviceDate(date: Date, tz: string, rolloverHour: number): string {
  const p = localParts(date, tz);
  const dayShift = p.hour < rolloverHour ? -1 : 0;
  return isoDate(p.year, p.month, p.day + dayShift);
}

export type RelativeDay = "today" | "tonight" | "last_night" | "yesterday" | "day_before_yesterday";

/**
 * Resolve a relative day word to a service date.
 *  - "today"/"tonight" is the current service day.
 *  - "yesterday" is always current service day - 1.
 *  - "last night" before rollover (e.g. 01:30) still means the ongoing night.
 */
export function resolveRelativeDay(term: RelativeDay, now: Date, tz: string, rolloverHour: number): string {
  const current = serviceDate(now, tz, rolloverHour);
  const p = localParts(now, tz);
  switch (term) {
    case "today":
    case "tonight":
      return current;
    case "last_night":
      return p.hour < rolloverHour ? current : addDays(current, -1);
    case "yesterday":
      return addDays(current, -1);
    case "day_before_yesterday":
      return addDays(current, -2);
  }
}

/**
 * Offset in minutes between UTC and tz at a given instant (tz - UTC).
 */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * An instant at a local wall-clock time on a given calendar date in tz.
 */
export function instantAtLocal(isoDay: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const offset = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - offset * 60000);
  // Second pass handles DST boundaries.
  const offset2 = tzOffsetMinutes(first, tz);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60000);
}

/**
 * A representative instant inside a service day: 21:00 local on the service
 * date itself (always after rollover, always before the next rollover).
 */
export function eveningOfServiceDay(serviceIso: string, tz: string): Date {
  return instantAtLocal(serviceIso, 21, 0, tz);
}

/** "Fri, Oct 30" style label for a service date; "10/30（五）" in Chinese. */
export function labelServiceDate(serviceIso: string, tz: string, lang: "zh" | "en" = "en"): string {
  const noon = instantAtLocal(serviceIso, 12, 0, tz);
  if (lang === "zh") {
    const p = localParts(noon, tz);
    const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    return `${p.month}/${p.day}（${wd}）`;
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })
    .format(noon);
}

/** Event time label, e.g. "Fri, Nov 6, 8:00 PM" or "11/6（五）20:00". */
export function labelEventTime(iso: string, tz: string, lang: "zh" | "en" = "en"): string {
  const d = new Date(iso);
  if (lang === "zh") {
    const p = localParts(d, tz);
    const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    return `${p.month}/${p.day}（${wd}）${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** Minutes since local midnight in tz. */
export function localMinuteOfDay(date: Date, tz: string): number {
  const p = localParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** True when the local hour is inside the quiet window [start, end). */
export function inQuietHours(date: Date, tz: string, start: number, end: number): boolean {
  const h = localParts(date, tz).hour;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // wraps midnight, e.g. 22 -> 9
}
