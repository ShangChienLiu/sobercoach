// Executes validated tool calls with the caller's RLS-scoped client.
// Every write is reversible; code renders the confirmation line and fills
// every number after the commit.

import { goalNote } from "./guidelines.ts";
import type { Db, DrinkEntry, EventRow } from "./db.ts";
import { toNumber } from "./db.ts";
import type { TurnContext } from "./context.ts";
import { entryPlaceholders, normalizeEntry } from "./context.ts";
import { beverageLabel, formatStd, type SizeChip, sizeChipsFor, stdDrinksNominal } from "./drinks.ts";
import { addDays, eveningOfServiceDay, instantAtLocal, isoDate, labelEventTime, labelServiceDate, localParts, resolveRelativeDay, type RelativeDay } from "./service_day.ts";
import type { ToolCall } from "./prompt.ts";
import { type EventKind, eventKindFor, nudgeAt, resolveEventDateTime } from "./events.ts";
import type { PlaceholderValues } from "./placeholders.ts";
import { searchHistory } from "./history.ts";

export interface EntryCard {
  entry_id: string;
  beverage: string;
  count: number;
  service_date: string;
  service_date_label: string;
  std_drinks: number;
  is_estimate: boolean;
  before?: { count: number; service_date: string };
  size_chips?: SizeChip[];
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  confirmation?: string; // code-rendered line, prepended to the reply
  error?: string;
  card?: EntryCard;
  placeholders?: PlaceholderValues;
  summary?: SummaryResult;
  /** Read results that need a second model pass; `line` is the code-rendered fact line. */
  followup?: { kind: "reminders" | "history"; data: unknown; line: string };
  fallbackKind: "logged" | "corrected" | "undone" | "event" | "goal" | "pref" | "generic";
  escalate?: string;
}

export interface SummaryResult {
  range: string;
  std_drinks: number;
  has_nominal: boolean;
  days_with_data: number;
  limit: number;
  remaining: number;
  days: Array<{ service_date: string; std_drinks: number | null; dry: boolean }>;
}

export class ToolError extends Error {}

/** Code-rendered lines in the user's language. zh = Traditional Chinese. */
const T = {
  en: {
    logged: (c: number, b: string, d: string, std: string) => `Logged ${c} ${b} for ${d}, ${std}.`,
    updated: (what: string, when: string) => `Updated: ${what}${when}.`,
    movedTo: (d: string) => ` moved to ${d}`,
    on: (d: string) => ` on ${d}`,
    already: (d: string) => `Right, they're already on ${d}.`,
    restored: (c: number, b: string, d: string) => `Restored ${c} ${b} on ${d}.`,
    removed: (c: number, b: string, d: string) => `Removed ${c} ${b} from ${d}.`,
    savedEvent: (t: string, w: string) => `Saved "${t}" for ${w}.`,
    savedReminder: (t: string, w: string) => `Saved reminder "${t}" for ${w}.`,
    cancelled: (t: string) => `Cancelled "${t}".`,
    updatedEvent: (t: string, w: string) => `Updated "${t}" to ${w}.`,
    goal: (n: number) => `Weekly limit set to ${n} standard drinks.`,
    remindersOn: (label: string) => `${label[0].toUpperCase()}${label.slice(1)} back on.`,
    remindersOff: (label: string) => `${label[0].toUpperCase()}${label.slice(1)} off.`,
    allReminders: "all reminders",
  },
  zh: {
    logged: (c: number, b: string, d: string, std: string) => `已記錄 ${d} ${c} ${b}，${std}。`,
    updated: (what: string, when: string) => `已更新：${what}${when}。`,
    movedTo: (d: string) => `，改到 ${d}`,
    on: (d: string) => `（${d}）`,
    already: (d: string) => `那幾杯本來就算在 ${d}。`,
    restored: (c: number, b: string, d: string) => `已還原 ${d} 的 ${c} ${b}。`,
    removed: (c: number, b: string, d: string) => `已移除 ${d} 的 ${c} ${b}。`,
    savedEvent: (t: string, w: string) => `已存「${t}」，${w}。`,
    savedReminder: (t: string, w: string) => `已設提醒「${t}」，${w}。`,
    cancelled: (t: string) => `已取消「${t}」。`,
    updatedEvent: (t: string, w: string) => `已把「${t}」改到 ${w}。`,
    goal: (n: number) => `每週上限設為 ${n} 標準杯。`,
    remindersOn: (label: string) => `${label}已重新打開。`,
    remindersOff: (label: string) => `${label}已關閉。`,
    allReminders: "所有提醒",
  },
} as const;

function bevZh(bev: string, count: number): string {
  const unit = bev === "wine" ? "杯紅白酒" : bev === "beer" ? "杯啤酒" : bev === "shot" ? "杯烈酒" : bev === "cocktail" ? "杯調酒" : "杯";
  void count;
  return unit;
}

function label(ctx: TurnContext, bev: string, count: number): string {
  return ctx.lang === "zh" ? bevZh(bev, count) : beverageLabel(bev, count);
}

function stdLabel(ctx: TurnContext, std: number, est: boolean): string {
  if (ctx.lang === "zh") return est ? `約 ${std.toFixed(1)} 標準杯（估）` : `${std.toFixed(1)} 標準杯`;
  return formatStd(std, est);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Shared schema slots map onto per-tool names; explicit names (e.g. from the mock) win. */
export function normalizeArgs(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    title: raw.title ?? raw.text ?? null,
    reason: raw.reason ?? raw.text ?? null,
    enabled: raw.enabled ?? raw.flag ?? null,
    cancel: raw.cancel ?? raw.flag ?? null,
  };
}

export async function executeTool(db: Db, ctx: TurnContext, rawCall: ToolCall): Promise<ToolOutcome> {
  const call: ToolCall = { ...rawCall, args: normalizeArgs(rawCall.args) };
  try {
    switch (call.name) {
      case "log_drink": return await logDrink(db, ctx, call.args, "chat");
      case "correct_entry": return await correctEntry(db, ctx, call.args);
      case "undo_entry": return await undoEntry(db, ctx, str(call.args.entry_id));
      case "add_event": return await addEvent(db, ctx, call.args);
      case "update_event": return await updateEvent(db, ctx, call.args);
      case "set_goal": return await setGoal(db, ctx, num(call.args.weekly_limit));
      case "set_reminder_pref": return await setReminderPref(db, ctx, str(call.args.category), call.args.enabled);
      case "get_summary": return await getSummary(db, ctx, str(call.args.range) ?? "week");
      case "get_reminders": return await getReminders(db, ctx);
      case "remember": return await remember(db, ctx, str(call.args.text) ?? str(call.args.reason));
      case "search_history": {
        const found = await searchHistory(db, ctx, str(call.args.text) ?? str(call.args.title) ?? ctx.userMessage ?? "");
        return { name: "search_history", ok: true, fallbackKind: "generic", followup: { kind: "history", data: { terms: found.terms, hits: found.hits }, line: found.line } };
      }
      case "escalate": return { name: "escalate", ok: true, fallbackKind: "generic", escalate: str(call.args.reason) ?? "model_requested" };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { name: call.name, ok: false, error: message, fallbackKind: "generic" };
  }
}

// --- log_drink ---------------------------------------------------------------

export async function logDrink(
  db: Db,
  ctx: TurnContext,
  args: Record<string, unknown>,
  source: "chat" | "quick_log" | "regex",
): Promise<ToolOutcome> {
  const count = num(args.count) ?? 1;
  if (count <= 0 || count > 50) throw new ToolError("count out of range");
  const beverage = str(args.beverage) ?? "drink";
  const volume = num(args.volume_ml);
  const abv = num(args.abv);
  if (volume != null && (volume < 10 || volume > 5000)) throw new ToolError("volume out of range");
  if (abv != null && (abv < 0 || abv > 100)) throw new ToolError("abv out of range");
  const rel = (str(args.relative_day) ?? "today") as RelativeDay;
  const tz = ctx.profile.timezone;
  const targetDay = resolveRelativeDay(rel, ctx.now, tz, ctx.profile.rollover_hour);
  const occurredAt = rel === "today" || rel === "tonight" ? ctx.now : eveningOfServiceDay(targetDay, tz);

  const { data, error } = await db
    .from("drink_entries")
    .insert({
      user_id: ctx.userId,
      occurred_at: occurredAt.toISOString(),
      service_date: targetDay,
      beverage,
      count,
      volume_ml: volume,
      abv,
      std_drinks_nominal: stdDrinksNominal(count),
      source,
    })
    .select("*")
    .single();
  if (error || !data) throw new ToolError(`insert failed: ${error?.message ?? "no row"}`);
  const entry = normalizeEntry(data);
  return {
    name: "log_drink",
    ok: true,
    fallbackKind: "logged",
    confirmation: T[ctx.lang].logged(entry.count, label(ctx, entry.beverage, entry.count), labelServiceDate(entry.service_date, tz, ctx.lang),
      stdLabel(ctx, entry.std_drinks_exact ?? entry.std_drinks_nominal, entry.std_drinks_exact == null)),
    card: cardFor(entry, tz, entry.std_drinks_exact == null ? sizeChipsFor(entry.beverage) : undefined),
    placeholders: entryPlaceholders(entry, tz),
  };
}

export function cardFor(entry: DrinkEntry, tz: string, chips?: SizeChip[], before?: DrinkEntry): EntryCard {
  return {
    entry_id: entry.id,
    beverage: entry.beverage,
    count: entry.count,
    service_date: entry.service_date,
    service_date_label: labelServiceDate(entry.service_date, tz),
    std_drinks: entry.std_drinks_exact ?? entry.std_drinks_nominal,
    is_estimate: entry.std_drinks_exact == null,
    before: before ? { count: before.count, service_date: before.service_date } : undefined,
    size_chips: chips,
  };
}

// --- correct_entry -------------------------------------------------------------

export async function correctEntry(db: Db, ctx: TurnContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const entryId = str(args.entry_id);
  if (!entryId) throw new ToolError("entry_id required");
  const before = ctx.recent48h.find((e) => e.id === entryId) ?? await fetchEntry(db, entryId);
  if (!before) throw new ToolError("entry not found in your recent log");
  if (before.status !== "active") throw new ToolError("that entry is no longer active");

  const tz = ctx.profile.timezone;
  const patch: Record<string, unknown> = {
    version: before.version + 1,
    previous_snapshot: snapshot(before),
    source: "correction",
  };
  const count = num(args.count);
  if (count != null) {
    if (count <= 0 || count > 50) throw new ToolError("count out of range");
    patch.count = count;
  }
  const bev = str(args.beverage);
  if (bev) patch.beverage = bev;
  const volume = num(args.volume_ml);
  if (volume != null) {
    if (volume < 10 || volume > 5000) throw new ToolError("volume out of range");
    patch.volume_ml = volume;
  }
  const abv = num(args.abv);
  if (abv != null) {
    if (abv < 0 || abv > 100) throw new ToolError("abv out of range");
    patch.abv = abv;
  }
  const rel = str(args.relative_day) as RelativeDay | null;
  if (rel) {
    const targetDay = resolveRelativeDay(rel, ctx.now, tz, ctx.profile.rollover_hour);
    if (targetDay !== before.service_date) {
      // Keep the original local wall-clock time on the new day (DST-safe).
      const dayDiff = Math.round((Date.parse(targetDay) - Date.parse(before.service_date)) / 86400000);
      const lp = localParts(new Date(before.occurred_at), tz);
      const calendarDay = addDays(isoDate(lp.year, lp.month, lp.day), dayDiff);
      patch.occurred_at = instantAtLocal(calendarDay, lp.hour, lp.minute, tz).toISOString();
      patch.service_date = targetDay;
    }
  }
  if (Object.keys(patch).length === 3) {
    if (rel) {
      return {
        name: "correct_entry",
        ok: true,
        fallbackKind: "corrected",
        confirmation: T[ctx.lang].already(labelServiceDate(before.service_date, tz, ctx.lang)),
        card: cardFor(before, tz),
        placeholders: entryPlaceholders(before, tz),
      };
    }
    throw new ToolError("nothing to change");
  }

  const { data, error } = await db
    .from("drink_entries")
    .update(patch)
    .eq("id", entryId)
    .eq("user_id", ctx.userId)
    .eq("version", before.version) // optimistic lock
    .select("*")
    .single();
  if (error || !data) throw new ToolError(`update failed: ${error?.message ?? "version conflict"}`);
  const after = normalizeEntry(data);
  const what = count != null && count !== before.count
    ? `${before.count} → ${after.count} ${label(ctx, after.beverage, after.count)}`
    : `${after.count} ${label(ctx, after.beverage, after.count)}`;
  const when = after.service_date !== before.service_date
    ? T[ctx.lang].movedTo(labelServiceDate(after.service_date, tz, ctx.lang))
    : T[ctx.lang].on(labelServiceDate(after.service_date, tz, ctx.lang));
  return {
    name: "correct_entry",
    ok: true,
    fallbackKind: "corrected",
    confirmation: T[ctx.lang].updated(what, when),
    card: cardFor(after, tz, after.std_drinks_exact == null ? sizeChipsFor(after.beverage) : undefined, before),
    placeholders: entryPlaceholders(after, tz),
  };
}

function snapshot(e: DrinkEntry): Record<string, unknown> {
  return {
    occurred_at: e.occurred_at,
    service_date: e.service_date,
    beverage: e.beverage,
    count: e.count,
    volume_ml: e.volume_ml,
    abv: e.abv,
    status: e.status,
    version: e.version,
  };
}

async function fetchEntry(db: Db, id: string): Promise<DrinkEntry | null> {
  const { data } = await db.from("drink_entries").select("*").eq("id", id).maybeSingle();
  return data ? normalizeEntry(data) : null;
}

// --- undo_entry ------------------------------------------------------------------

/** Undo: restore the previous snapshot if one exists, otherwise mark undone. */
export async function undoEntry(db: Db, ctx: TurnContext, entryId: string | null): Promise<ToolOutcome> {
  const target = entryId
    ? ctx.recent48h.find((e) => e.id === entryId) ?? await fetchEntry(db, entryId)
    : [...ctx.recent48h].filter((e) => e.status === "active")
      .sort((a, b) => Date.parse(b.updated_at ?? b.occurred_at) - Date.parse(a.updated_at ?? a.occurred_at))[0] ?? null;
  if (!target) throw new ToolError("nothing recent to undo");
  if (target.status !== "active") throw new ToolError("that entry was already undone");
  const tz = ctx.profile.timezone;

  if (target.previous_snapshot && target.version > 1) {
    const snap = target.previous_snapshot;
    const { data, error } = await db
      .from("drink_entries")
      .update({
        occurred_at: snap.occurred_at,
        service_date: snap.service_date,
        beverage: snap.beverage,
        count: toNumber(snap.count, target.count),
        volume_ml: snap.volume_ml ?? null,
        abv: snap.abv ?? null,
        version: target.version + 1,
        previous_snapshot: null,
      })
      .eq("id", target.id)
      .eq("user_id", ctx.userId)
      .eq("version", target.version)
      .select("*")
      .single();
    if (error || !data) throw new ToolError(`undo failed: ${error?.message ?? "conflict"}`);
    const restored = normalizeEntry(data);
    return {
      name: "undo_entry",
      ok: true,
      fallbackKind: "undone",
      confirmation: T[ctx.lang].restored(restored.count, label(ctx, restored.beverage, restored.count), labelServiceDate(restored.service_date, tz, ctx.lang)),
      card: cardFor(restored, tz, undefined, target),
      placeholders: entryPlaceholders(restored, tz),
    };
  }

  const { data, error } = await db
    .from("drink_entries")
    .update({ status: "undone", version: target.version + 1, previous_snapshot: snapshot(target) })
    .eq("id", target.id)
    .eq("user_id", ctx.userId)
    .eq("version", target.version)
    .select("*")
    .single();
  if (error || !data) throw new ToolError(`undo failed: ${error?.message ?? "conflict"}`);
  const undone = normalizeEntry(data);
  return {
    name: "undo_entry",
    ok: true,
    fallbackKind: "undone",
    confirmation: T[ctx.lang].removed(undone.count, label(ctx, undone.beverage, undone.count), labelServiceDate(undone.service_date, tz, ctx.lang)),
    card: cardFor(undone, tz),
    placeholders: entryPlaceholders(undone, tz),
  };
}

// --- events --------------------------------------------------------------------

export async function addEvent(db: Db, ctx: TurnContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const title = str(args.title) ?? "Event";
  const tz = ctx.profile.timezone;
  const kind = eventKindFor(ctx.userMessage ?? "", title);
  const startsAt = resolveEventDateTime({ date: str(args.date), time: str(args.time), daysFromNow: num(args.days_from_now), kind, now: ctx.now, tz });
  const { data, error } = await db
    .from("events")
    .insert({ user_id: ctx.userId, title, starts_at: startsAt.toISOString(), timezone: tz, source_message: ctx.userMessage ?? str(args.reason), kind })
    .select("id,user_id,title,starts_at,timezone,status,kind")
    .single();
  if (error || !data) throw new ToolError(`event insert failed: ${error?.message ?? "no row"}`);
  const ev = data as EventRow;
  const when = labelEventTime(ev.starts_at, tz, ctx.lang);
  return {
    name: "add_event",
    ok: true,
    fallbackKind: "event",
    confirmation: kind === "general_reminder" ? T[ctx.lang].savedReminder(ev.title, when) : T[ctx.lang].savedEvent(ev.title, when),
    placeholders: { event_title: ev.title, event_when: when },
  };
}

export function eventWhenLabel(ev: EventRow, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(ev.starts_at));
}

export async function updateEvent(db: Db, ctx: TurnContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const id = str(args.event_id);
  if (!id) throw new ToolError("event_id required");
  const patch: Record<string, unknown> = {};
  if (args.cancel === true) patch.status = "cancelled";
  const title = str(args.title);
  if (title) patch.title = title;
  const date = str(args.date), time = str(args.time), days = num(args.days_from_now);
  if (date || time || days != null) {
    const current = ctx.events.find((e) => e.id === id);
    const kind = (current?.kind ?? eventKindFor(ctx.userMessage ?? "", title ?? current?.title ?? "")) as EventKind;
    patch.starts_at = resolveEventDateTime({ date, time, daysFromNow: days, kind, now: ctx.now, tz: ctx.profile.timezone }).toISOString();
  }
  if (!Object.keys(patch).length) throw new ToolError("nothing to change");
  const { data, error } = await db.from("events").update(patch).eq("id", id).eq("user_id", ctx.userId)
    .select("id,user_id,title,starts_at,timezone,status,kind").single();
  if (error || !data) throw new ToolError(`event update failed: ${error?.message ?? "no row"}`);
  const ev = data as EventRow;
  const when = labelEventTime(ev.starts_at, ctx.profile.timezone, ctx.lang);
  return {
    name: "update_event",
    ok: true,
    fallbackKind: "event",
    confirmation: ev.status === "cancelled" ? T[ctx.lang].cancelled(ev.title) : T[ctx.lang].updatedEvent(ev.title, when),
    placeholders: { event_title: ev.title, event_when: when },
  };
}

// --- goal & prefs -----------------------------------------------------------------

export async function setGoal(db: Db, ctx: TurnContext, weeklyLimit: number | null): Promise<ToolOutcome> {
  if (weeklyLimit == null || weeklyLimit < 0 || weeklyLimit > 70) throw new ToolError("weekly_limit out of range");
  const { error } = await db.from("profiles").update({ weekly_limit: weeklyLimit, updated_at: new Date().toISOString() })
    .eq("user_id", ctx.userId);
  if (error) throw new ToolError(`goal update failed: ${error.message}`);
  return {
    name: "set_goal",
    ok: true,
    fallbackKind: "goal",
    confirmation: [T[ctx.lang].goal(weeklyLimit), goalNote(weeklyLimit, ctx.profile.sex_for_guidelines ?? null, ctx.lang)].filter(Boolean).join(" "),
    placeholders: { weekly_limit: `${weeklyLimit}` },
  };
}

export async function setReminderPref(db: Db, ctx: TurnContext, category: string | null, enabledRaw: unknown): Promise<ToolOutcome> {
  const enabled = enabledRaw === true;
  const cats = category && category !== "all" ? [category] : ["event_prep", "morning_after", "missed_log"];
  const rows = cats.map((c) => ({ user_id: ctx.userId, category: c, enabled, updated_at: new Date().toISOString() }));
  const { error } = await db.from("consents").upsert(rows, { onConflict: "user_id,category" });
  if (error) throw new ToolError(`consent update failed: ${error.message}`);
  const which = cats.length === 3 ? T[ctx.lang].allReminders : (ctx.lang === "zh" ? `${cats[0] === "event_prep" ? "聚會前" : cats[0] === "morning_after" ? "隔天早上" : "沒紀錄"}提醒` : cats[0].replace("_", " ") + " reminders");
  return {
    name: "set_reminder_pref",
    ok: true,
    fallbackKind: "pref",
    confirmation: enabled ? T[ctx.lang].remindersOn(which) : T[ctx.lang].remindersOff(which),
  };
}

// --- get_summary ----------------------------------------------------------------

export async function getSummary(db: Db, ctx: TurnContext, range: string): Promise<ToolOutcome> {
  const anchor = range === "last_week" ? shiftIso(ctx.todayService, -7) : ctx.todayService;
  const start = range === "today" ? anchor : shiftIso(anchor, -6);
  const { data, error } = await db.from("daily_totals").select("*").eq("user_id", ctx.userId)
    .gte("service_date", start).lte("service_date", anchor).order("service_date");
  if (error) throw new ToolError(`summary failed: ${error.message}`);
  const byDay = new Map((data ?? []).map((r) => [r.service_date as string, r]));
  const days: SummaryResult["days"] = [];
  for (let d = start; d <= anchor; d = shiftIso(d, 1)) {
    const row = byDay.get(d);
    days.push({
      service_date: d,
      std_drinks: row ? toNumber(row.std_drinks) : null,
      dry: Boolean(row?.confirmed_dry) && toNumber(row?.active_entries) === 0,
    });
  }
  const std = days.reduce((s, d) => s + (d.std_drinks ?? 0), 0);
  const hasNominal = (data ?? []).some((r) => Boolean(r.has_nominal));
  const limit = ctx.profile.weekly_limit;
  const summary: SummaryResult = {
    range,
    std_drinks: Math.round(std * 10) / 10,
    has_nominal: hasNominal,
    days_with_data: days.filter((d) => d.std_drinks != null).length,
    limit,
    remaining: Math.max(0, Math.round((limit - std) * 10) / 10),
    days,
  };
  return { name: "get_summary", ok: true, fallbackKind: "generic", summary };
}

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
}

/** Code-rendered summary line; the model never writes these numbers. */
export function renderSummaryLine(s: SummaryResult, tz: string, lang: "zh" | "en" = "en"): string {
  if (lang === "zh") {
    const estZ = s.has_nominal ? "（估）" : "";
    const missingZ = 7 - s.days_with_data;
    const gapZ = s.range === "today" ? "" : missingZ > 0 ? ` 有 ${missingZ} 天沒有紀錄。` : "";
    const labelZ = s.range === "today" ? "今天" : s.range === "last_week" ? "上週" : "本週";
    return `${labelZ}：${s.std_drinks.toFixed(1)} / ${s.limit} 標準杯${estZ}。${gapZ}`;
  }
  const est = s.has_nominal ? " (est.)" : "";
  const missing = 7 - s.days_with_data;
  const gap = s.range === "today" ? "" : missing > 0 ? ` ${missing} day${missing === 1 ? "" : "s"} with no data.` : "";
  const label = s.range === "today" ? "Today" : s.range === "last_week" ? "Last week" : "This week";
  const first = s.days[0] ? labelServiceDate(s.days[0].service_date, tz) : "";
  const last = s.days[s.days.length - 1] ? labelServiceDate(s.days[s.days.length - 1].service_date, tz) : "";
  const span = s.range === "today" ? "" : ` (${first} – ${last})`;
  return `${label}${span}: ${s.std_drinks.toFixed(1)} of ${s.limit} standard drinks${est}.${gap}`;
}

// --- remember ------------------------------------------------------------------

const MAX_MEMORY_FACTS = 14;

/** Appends one short fact to coach_memory as a bullet; dedupes and caps the list. */
export async function remember(db: Db, ctx: TurnContext, fact: string | null): Promise<ToolOutcome> {
  const clean = (fact ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (clean.length < 4) throw new ToolError("nothing to remember");
  const existing = ctx.memory.split("\n").map((l) => l.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
  if (existing.some((e) => e.toLowerCase() === clean.toLowerCase())) {
    return { name: "remember", ok: true, fallbackKind: "generic" };
  }
  const facts = [...existing, clean].slice(-MAX_MEMORY_FACTS);
  const summary = facts.map((f) => `- ${f}`).join("\n");
  const { error } = await db.from("coach_memory").upsert({ user_id: ctx.userId, summary, updated_at: new Date().toISOString() });
  if (error) throw new ToolError(`memory write failed: ${error.message}`);
  return { name: "remember", ok: true, fallbackKind: "generic" };
}

// --- get_reminders ---------------------------------------------------------------

interface ReminderFact {
  trigger: string;
  status: string;
  when: string;
  why: string;
  blocked: string | null;
}

export async function getReminders(db: Db, ctx: TurnContext): Promise<ToolOutcome> {
  const tz = ctx.profile.timezone;
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const { data: rows } = await db.from("reminder_log")
    .select("trigger,status,scheduled_for,sent_at,why_now,block_reason")
    .eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(5);
  const sent = (rows ?? []).map((r) => ({
    trigger: String(r.trigger).replace("_", " "),
    status: String(r.status),
    when: fmt(String(r.sent_at ?? r.scheduled_for)),
    why: String(r.why_now ?? ""),
    blocked: (r.block_reason as string | null) ?? null,
  })) as ReminderFact[];
  const upcoming = ctx.events.map((e) => ({ title: e.title, when: fmt(e.starts_at), push_at: fmt(nudgeAt(new Date(e.starts_at), (e.kind ?? "drinking_social") as EventKind).toISOString()) }));
  const consentsOff = ctx.consents.filter((c) => !c.enabled).map((c) => c.category.replace("_", " "));
  const lastSent = sent.find((r) => r.status === "sent");
  const parts: string[] = [];
  parts.push(lastSent ? `Last reminder sent ${lastSent.when} (${lastSent.trigger}).` : "No reminder has been sent yet.");
  const lastBlocked = sent.find((r) => r.status === "blocked" || r.status === "pending");
  if (lastBlocked?.blocked) parts.push(`One was held back: ${lastBlocked.blocked.replace("BLOCKED_BY_", "").toLowerCase().replace(/_/g, " ")}.`);
  if (upcoming.length) parts.push(`Next: ${upcoming[0].title} ${upcoming[0].when}, nudge due ${upcoming[0].push_at}.`);
  if (consentsOff.length) parts.push(`Off: ${consentsOff.join(", ")}.`);
  const line = parts.join(" ");
  return {
    name: "get_reminders",
    ok: true,
    fallbackKind: "generic",
    followup: { kind: "reminders", data: { sent, upcoming, consents_off: consentsOff }, line },
  };
}
