// Builds what the agent sees every turn (~400 volatile tokens) and the
// placeholder values code fills into replies. All numbers come from SQL.

import type { ConsentRow, DailyTotal, Db, DrinkEntry, EventRow, MessageRow, Profile } from "./db.ts";
import { toNumber } from "./db.ts";
import { addDays, isoDate, labelServiceDate, localParts, serviceDate } from "./service_day.ts";
import type { PlaceholderValues } from "./placeholders.ts";
import { beverageLabel } from "./drinks.ts";

export interface WeeklyTotals {
  stdDrinks: number;
  hasNominal: boolean;
  daysWithData: number;
  remaining: number;
  pctOfLimit: number;
}

export interface TurnContext {
  userId: string;
  now: Date;
  profile: Profile;
  todayService: string;
  memory: string;
  weekly: WeeklyTotals;
  today: DailyTotal | null; // null = NO_DATA
  recent48h: DrinkEntry[];
  events: EventRow[];
  consents: ConsentRow[];
  lastMessages: MessageRow[];
  strongCallsToday: number;
  /** This user's model spend since the start of their service day, in USD. */
  spendTodayUsd: number;
  lang: "zh" | "en";
  /** The typed message of this turn, for tools that classify from the user's words. */
  userMessage?: string;
}

export async function loadProfile(db: Db, userId: string): Promise<Profile> {
  const { data, error } = await db.from("profiles").select("*").eq("user_id", userId).single();
  if (error || !data) throw new Error(`profile load failed: ${error?.message ?? "no row"}`);
  return {
    ...data,
    rollover_hour: toNumber(data.rollover_hour, 4),
    weekly_limit: toNumber(data.weekly_limit, 14),
    quiet_start: toNumber(data.quiet_start, 22),
    quiet_end: toNumber(data.quiet_end, 9),
  } as Profile;
}

export async function loadWeekly(db: Db, userId: string, anchor: string, limit: number): Promise<WeeklyTotals> {
  const { data, error } = await db.rpc("weekly_total", { p_user: userId, p_anchor: anchor });
  if (error) throw new Error(`weekly_total failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const stdDrinks = toNumber(row?.std_drinks, 0);
  return {
    stdDrinks,
    hasNominal: Boolean(row?.has_nominal),
    daysWithData: toNumber(row?.days_with_data, 0),
    remaining: Math.max(0, Math.round((limit - stdDrinks) * 10) / 10),
    pctOfLimit: limit > 0 ? stdDrinks / limit : 0,
  };
}

export async function loadDailyTotal(db: Db, userId: string, day: string): Promise<DailyTotal | null> {
  const { data } = await db.from("daily_totals").select("*").eq("user_id", userId).eq("service_date", day).maybeSingle();
  if (!data) return null;
  return {
    service_date: data.service_date,
    drinks_count: toNumber(data.drinks_count),
    std_drinks: toNumber(data.std_drinks),
    has_nominal: Boolean(data.has_nominal),
    confirmed_dry: Boolean(data.confirmed_dry),
    active_entries: toNumber(data.active_entries),
  };
}

export async function loadRecent48h(db: Db, userId: string, now: Date): Promise<DrinkEntry[]> {
  const since = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("drink_entries")
    .select("*")
    .eq("user_id", userId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`recent entries failed: ${error.message}`);
  return (data ?? []).map(normalizeEntry);
}

export function normalizeEntry(row: Record<string, unknown>): DrinkEntry {
  return {
    ...(row as unknown as DrinkEntry),
    count: toNumber(row.count),
    volume_ml: row.volume_ml == null ? null : toNumber(row.volume_ml),
    abv: row.abv == null ? null : toNumber(row.abv),
    std_drinks_exact: row.std_drinks_exact == null ? null : toNumber(row.std_drinks_exact),
    std_drinks_nominal: toNumber(row.std_drinks_nominal),
    version: toNumber(row.version, 1),
  };
}

export async function loadEvents(db: Db, userId: string, now: Date): Promise<EventRow[]> {
  const until = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("events")
    .select("id,user_id,title,starts_at,timezone,status,kind")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("starts_at", new Date(now.getTime() - 12 * 3600 * 1000).toISOString())
    .lte("starts_at", until)
    .order("starts_at");
  return (data ?? []) as EventRow[];
}

export async function buildTurnContext(db: Db, userId: string, now: Date, strongCallsToday: number, spendTodayUsd = 0, preloaded?: TurnContext["profile"]): Promise<TurnContext> {
  const profile = preloaded ?? await loadProfile(db, userId);
  const todayService = serviceDate(now, profile.timezone, profile.rollover_hour);
  const [memoryRes, weekly, today, recent48h, events, consentsRes, msgsRes] = await Promise.all([
    db.from("coach_memory").select("summary").eq("user_id", userId).maybeSingle(),
    loadWeekly(db, userId, todayService, profile.weekly_limit),
    loadDailyTotal(db, userId, todayService),
    loadRecent48h(db, userId, now),
    loadEvents(db, userId, now),
    db.from("consents").select("category,enabled").eq("user_id", userId),
    db.from("messages").select("role,content,created_at").eq("user_id", userId).in("role", ["user", "assistant"])
      .order("created_at", { ascending: false }).limit(6),
  ]);
  return {
    userId,
    now,
    profile,
    todayService,
    memory: (memoryRes.data?.summary as string | undefined) ?? "",
    weekly,
    today,
    recent48h,
    events,
    consents: (consentsRes.data ?? []) as ConsentRow[],
    lastMessages: ((msgsRes.data ?? []) as MessageRow[]).reverse(),
    strongCallsToday,
    spendTodayUsd,
    lang: "en",
  };
}

/** The volatile part of the prompt. Compact, labelled, no prose. */
export function renderContext(ctx: TurnContext): string {
  const p = ctx.profile;
  const lp = localParts(ctx.now, p.timezone);
  const nowLabel = `${lp.weekday} ${isoDate(lp.year, lp.month, lp.day)} ${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")} local`;
  const lines: string[] = [];
  lines.push(`## profile`);
  lines.push(`name=${p.display_name ?? "friend"} tz=${p.timezone} rollover_hour=${p.rollover_hour} goal=${p.goal_type} weekly_limit=${p.weekly_limit}`);
  lines.push(`now=${nowLabel} current_service_date=${ctx.todayService}`);
  lines.push(`## coach_memory (facts the user told you; use them naturally)`);
  lines.push(ctx.memory.trim() ? ctx.memory.slice(0, 900) : "(nothing yet)");
  lines.push(`## totals (computed by code; cite only via placeholders)`);
  lines.push(
    `week_std=${ctx.weekly.stdDrinks.toFixed(1)}${ctx.weekly.hasNominal ? " (includes unmeasured)" : ""} remaining=${ctx.weekly.remaining.toFixed(1)} days_with_data=${ctx.weekly.daysWithData}/7`,
  );
  lines.push(
    ctx.today
      ? `today=${ctx.today.confirmed_dry && ctx.today.active_entries === 0 ? "DRY" : `${ctx.today.std_drinks.toFixed(1)} std`}`
      : `today=NO_DATA`,
  );
  lines.push(`## recent_48h_entries (use these ids)`);
  if (!ctx.recent48h.length) lines.push("(none)");
  for (const e of ctx.recent48h) {
    const lpE = localParts(new Date(e.occurred_at), p.timezone);
    const sz = e.volume_ml != null && e.abv != null ? ` ${e.volume_ml}ml ${e.abv}%` : " size=unknown";
    lines.push(
      `- id=${e.id} ${e.status} ${e.count}x ${e.beverage}${sz} service_date=${e.service_date} at=${lpE.weekday} ${String(lpE.hour).padStart(2, "0")}:${String(lpE.minute).padStart(2, "0")}`,
    );
  }
  lines.push(`## upcoming_events (next 14 days)`);
  if (!ctx.events.length) lines.push("(none)");
  for (const ev of ctx.events) {
    const lpEv = localParts(new Date(ev.starts_at), p.timezone);
    lines.push(`- id=${ev.id} "${ev.title}" ${lpEv.weekday} ${isoDate(lpEv.year, lpEv.month, lpEv.day)} ${String(lpEv.hour).padStart(2, "0")}:${String(lpEv.minute).padStart(2, "0")} local (${daysUntil(ctx.todayService, isoDate(lpEv.year, lpEv.month, lpEv.day))})`);
  }
  lines.push(`## reminders ${ctx.consents.map((c) => `${c.category}=${c.enabled ? "on" : "off"}`).join(" ")}`);
  lines.push(`## last_messages`);
  for (const m of ctx.lastMessages) lines.push(`${m.role}: ${m.content.slice(0, 240)}`);
  return lines.join("\n");
}

function daysUntil(todayIso: string, dayIso: string): string {
  const d = Math.round((Date.parse(dayIso) - Date.parse(todayIso)) / 86400000);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d > 1 ? `in ${d} days` : `${-d} days ago`;
}

export function paceLabel(weekly: WeeklyTotals, limit: number, lang: "zh" | "en" = "en"): string {
  const est = weekly.hasNominal ? (lang === "zh" ? "（估）" : " (est.)") : "";
  if (lang === "zh") {
    return weekly.stdDrinks >= limit
      ? `本週已 ${weekly.stdDrinks.toFixed(1)} / ${limit} 杯${est}。`
      : `本週還剩約 ${weekly.remaining.toFixed(1)} / ${limit} 杯${est}。`;
  }
  if (weekly.stdDrinks >= limit) {
    return `You're at ${weekly.stdDrinks.toFixed(1)} of ${limit} this week${est}.`;
  }
  return `~${weekly.remaining.toFixed(1)} of ${limit} left this week${est}.`;
}

export function basePlaceholders(ctx: TurnContext, weekly: WeeklyTotals, today: DailyTotal | null): PlaceholderValues {
  const est = weekly.hasNominal ? " (est.)" : "";
  return {
    weekly_total: `${weekly.stdDrinks.toFixed(1)}${est}`,
    weekly_remaining: `${weekly.remaining.toFixed(1)}${est}`,
    weekly_limit: `${ctx.profile.weekly_limit}`,
    today_total: today ? `${today.std_drinks.toFixed(1)}${today.has_nominal ? " (est.)" : ""}` : "no data",
    pace_label: paceLabel(weekly, ctx.profile.weekly_limit, ctx.lang),
    standard_drink: ctx.lang === "zh"
      ? "約 14 公克純酒精：355 ml 的 5% 啤酒、148 ml 的 12% 葡萄酒，或 44 ml 的 40% 烈酒"
      : "about 14 g of alcohol: a 12 oz 5% beer, 5 oz of 12% wine, or 1.5 oz of 40% spirits",
  };
}

export function entryPlaceholders(entry: DrinkEntry, tz: string): PlaceholderValues {
  return {
    logged_count: `${entry.count}`,
    logged_beverage: beverageLabel(entry.beverage, entry.count),
    logged_date: labelServiceDate(entry.service_date, tz),
  };
}

export function yesterdayOf(ctx: TurnContext): string {
  return addDays(ctx.todayService, -1);
}
