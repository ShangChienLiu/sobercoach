// evaluate-triggers: the proactive path. Called by pg_cron every 15 minutes
// (shared secret) or by a test account's debug menu (JWT + simulated_now).
// Every candidate push is a reminder_log row with an idempotency key; gates
// run at schedule time and again at send time; any failed gate means no push.

import { CORS, currentUserId, env, jsonResponse, serviceClient, toNumber, userClient } from "../_shared/db.ts";
import type { Db, EventRow, Profile } from "../_shared/db.ts";
import { loadDailyTotal, loadProfile, loadWeekly } from "../_shared/context.ts";
import { addDays, instantAtLocal, labelServiceDate, localMinuteOfDay, serviceDate } from "../_shared/service_day.ts";
import { planFor } from "../_shared/events.ts";
import { blockedCode, evaluateGates, type GateTrace, type TriggerKind } from "../_shared/gates.ts";
import { apnsConfigFromEnv, sendPush } from "../_shared/apns.ts";

interface TriggerRequest {
  simulated_now?: string;
  force_apns?: boolean;
  dry_run?: boolean;
}

interface Candidate {
  trigger: TriggerKind;
  eventId: string | null;
  idempotencyKey: string;
  scheduledFor: Date;
  whyNow: string;
  title: string;
  body: string;
}

interface CandidateReport {
  trigger: TriggerKind;
  idempotency_key: string;
  scheduled_for: string;
  why_now: string;
  body: string;
  status: "sent" | "blocked" | "pending" | "failed" | "stale" | "already_sent" | "dry_run";
  block_reason: string | null;
  gate_trace: GateTrace | null;
  apns: { ok: boolean; status: number; reason: string | null } | null;
}

const EVENT_PREP_LEAD_MS = 3 * 3600 * 1000;
const MORNING_AFTER_HOUR = 10;
const MISSED_LOG_HOUR = 21;
const PUSH_CATEGORY = "SOBERCOACH_REMINDER";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "POST only" }, 405);

  let body: TriggerRequest = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) as TriggerRequest : {};
  } catch {
    return jsonResponse({ success: false, error: "invalid JSON" }, 400);
  }

  const svc = serviceClient();
  const secret = env("TRIGGER_SECRET");
  const fromCron = Boolean(secret) && req.headers.get("x-trigger-secret") === secret;

  if (fromCron) {
    const { data } = await svc.from("profiles").select("user_id").not("apns_token", "is", null);
    const ids = (data ?? []).map((r) => r.user_id as string);
    const reports: Record<string, CandidateReport[] | { error: string }> = {};
    for (const id of ids) {
      try {
        reports[id] = await evaluateUser(svc, id, new Date(), false, false);
      } catch (error: unknown) {
        // One user's bad data (e.g. an invalid timezone) must not stop the others.
        reports[id] = { error: error instanceof Error ? error.message : "unknown error" };
        console.error("evaluateUser failed", id, reports[id]);
      }
    }
    return jsonResponse({ success: true, data: { users: ids.length, reports } });
  }

  // Test-account simulator: a user may only evaluate themselves.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ success: false, error: "missing auth" }, 401);
  const userDb = userClient(authHeader);
  const userId = await currentUserId(userDb);
  if (!userId) return jsonResponse({ success: false, error: "invalid session" }, 401);
  const profile = await loadProfile(userDb, userId);
  const wantsSimulation = body.simulated_now !== undefined || body.force_apns !== undefined;
  if (wantsSimulation && !profile.is_test) {
    return jsonResponse({ success: false, error: "simulated_now and force_apns are only honored for test accounts" }, 403);
  }
  if (wantsSimulation && env("ENVIRONMENT") === "production") {
    return jsonResponse({ success: false, error: "simulator disabled in production" }, 403);
  }
  const now = body.simulated_now && !Number.isNaN(Date.parse(body.simulated_now)) ? new Date(body.simulated_now) : new Date();
  const report = await evaluateUser(svc, userId, now, body.force_apns === true, body.dry_run === true);
  return jsonResponse({ success: true, data: { now: now.toISOString(), reports: report } });
});

// --- per-user evaluation -------------------------------------------------------------

async function evaluateUser(svc: Db, userId: string, now: Date, forceApns: boolean, dryRun: boolean): Promise<CandidateReport[]> {
  const profile = await loadProfile(svc, userId);
  const tz = profile.timezone;
  const today = serviceDate(now, tz, profile.rollover_hour);
  const candidates = await collectCandidates(svc, profile, now, today);
  const reports: CandidateReport[] = [];
  for (const c of candidates) reports.push(await processCandidate(svc, profile, now, today, c, forceApns, dryRun));
  return reports;
}

async function collectCandidates(svc: Db, profile: Profile, now: Date, today: string): Promise<Candidate[]> {
  const tz = profile.timezone;
  const userId = profile.user_id;
  const out: Candidate[] = [];

  // Events in a window around now: upcoming (prep) and yesterday (morning after).
  const { data: evRows } = await svc.from("events").select("id,user_id,title,starts_at,timezone,status,kind")
    .eq("user_id", userId).eq("status", "active")
    .gte("starts_at", new Date(now.getTime() - 36 * 3600 * 1000).toISOString())
    .lte("starts_at", new Date(now.getTime() + EVENT_PREP_LEAD_MS + 15 * 60 * 1000).toISOString());
  const events = (evRows ?? []) as EventRow[];

  const weekly = await loadWeekly(svc, userId, today, profile.weekly_limit);
  const { data: memRow } = events.length ? await svc.from("coach_memory").select("summary").eq("user_id", userId).maybeSingle() : { data: null };
  const memorySummary = (memRow as { summary?: string } | null)?.summary ?? "";
  for (const ev of events) {
    const starts = new Date(ev.starts_at);
    const evService = serviceDate(starts, tz, profile.rollover_hour);
    const kind = ev.kind ?? "drinking_social";
    const whenLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(starts);
    if (kind === "general_reminder") {
      // A plain reminder fires at its time with its own words; the drinking template never applies and there is no morning after.
      const dueAt = starts;
      if (now >= dueAt && now < new Date(dueAt.getTime() + 6 * 3600 * 1000)) {
        const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(starts);
        out.push({
          trigger: "event_prep",
          eventId: ev.id,
          idempotencyKey: `${userId}:event_prep:${ev.id}:${evService}`,
          scheduledFor: dueAt,
          whyNow: `Reminder "${ev.title}" due ${dayLabel} ${whenLabel}`,
          title: "Reminder",
          body: `Reminder: ${ev.title} (${dayLabel} ${whenLabel}).`,
        });
      }
      continue;
    }
    const prepAt = new Date(starts.getTime() - EVENT_PREP_LEAD_MS);
    if (now >= prepAt && now < starts) {
      const est = weekly.hasNominal ? " (incl. unmeasured)" : "";
      const plan = planFor(memorySummary, ev.title);
      const why = `${ev.title} at ${whenLabel}; ~${weekly.remaining.toFixed(0)} drinks left in your weekly limit${est}${plan ? "; plan on file" : ""}`;
      out.push({
        trigger: "event_prep",
        eventId: ev.id,
        idempotencyKey: `${userId}:event_prep:${ev.id}:${evService}`,
        scheduledFor: prepAt,
        whyNow: why,
        title: ev.title,
        body: plan
          ? `${whenLabel} tonight. ${weekly.remaining.toFixed(0)} of ${profile.weekly_limit} left this week${est}. Your plan: ${plan}`
          : `${whenLabel} tonight. ${weekly.remaining.toFixed(0)} of ${profile.weekly_limit} left this week${est}. Pick a number before you go?`,
      });
    }
    const morningAt = instantAtLocal(addDays(evService, 1), MORNING_AFTER_HOUR, 0, tz);
    if (now >= morningAt && now < new Date(morningAt.getTime() + 12 * 3600 * 1000)) {
      const dayTotal = await loadDailyTotal(svc, userId, evService);
      const label = labelServiceDate(evService, tz);
      const body = dayTotal
        ? `Last night: ${dayTotal.std_drinks.toFixed(1)}${dayTotal.has_nominal ? " (est.)" : ""}. ${weeklyLine(weekly, profile.weekly_limit)}`
        : `Nothing logged for ${ev.title}. Log it, or mark it dry?`;
      out.push({
        trigger: "morning_after",
        eventId: ev.id,
        idempotencyKey: `${userId}:morning_after:${ev.id}:${evService}`,
        scheduledFor: morningAt,
        whyNow: dayTotal ? `Recap after ${ev.title}` : `NO_DATA for ${ev.title} on ${label}`,
        title: dayTotal ? "Morning after" : "How did it go?",
        body,
      });
    }
  }

  // Missed log: 21:00 local, NO_DATA for today and yesterday, no app open for 2 service days.
  const missedAt = instantAtLocal(today, MISSED_LOG_HOUR, 0, tz);
  if (now >= missedAt && localMinuteOfDay(now, tz) < 23 * 60) {
    const [t0, t1] = await Promise.all([loadDailyTotal(svc, userId, today), loadDailyTotal(svc, userId, addDays(today, -1))]);
    const lastOpened = profile.last_opened_at ? new Date(profile.last_opened_at) : null;
    const openedRecently = lastOpened ? serviceDate(lastOpened, tz, profile.rollover_hour) >= addDays(today, -1) : false;
    if (!t0 && !t1 && !openedRecently) {
      out.push({
        trigger: "missed_log",
        eventId: null,
        idempotencyKey: `${userId}:missed_log::${today}`,
        scheduledFor: missedAt,
        whyNow: "Two quiet service days with NO_DATA and no app open",
        title: "Two quiet days",
        body: "Nothing logged since the day before yesterday. Log them, or mark them dry. Either is fine.",
      });
    }
  }
  return out;
}

function weeklyLine(weekly: { remaining: number; hasNominal: boolean }, limit: number): string {
  return `${weekly.remaining.toFixed(0)} of ${limit} left this week${weekly.hasNominal ? " (est.)" : ""}.`;
}

// --- candidate processing: dedupe, gates, draft, send -------------------------------

async function processCandidate(
  svc: Db,
  profile: Profile,
  now: Date,
  today: string,
  c: Candidate,
  forceApns: boolean,
  dryRun: boolean,
): Promise<CandidateReport> {
  const base: CandidateReport = {
    trigger: c.trigger,
    idempotency_key: c.idempotencyKey,
    scheduled_for: c.scheduledFor.toISOString(),
    why_now: c.whyNow,
    body: c.body,
    status: "pending",
    block_reason: null,
    gate_trace: null,
    apns: null,
  };

  // Idempotent row: insert if absent, otherwise reuse. A sent row is never sent twice.
  const { data: existing } = await svc.from("reminder_log").select("id,status").eq("idempotency_key", c.idempotencyKey).maybeSingle();
  if (existing && existing.status !== "pending" && existing.status !== "sending") {
    return { ...base, status: existing.status === "sent" ? "already_sent" : existing.status as CandidateReport["status"] };
  }
  let rowId = existing?.id as string | undefined;
  if (!rowId && !dryRun) {
    const { data: inserted, error } = await svc.from("reminder_log").insert({
      user_id: profile.user_id,
      idempotency_key: c.idempotencyKey,
      trigger: c.trigger,
      event_id: c.eventId,
      why_now: c.whyNow,
      body: c.body,
      scheduled_for: c.scheduledFor.toISOString(),
      status: "pending",
    }).select("id").single();
    if (error || !inserted) return { ...base, status: "failed", block_reason: `insert failed: ${error?.message ?? "unknown"}` };
    rowId = inserted.id as string;
  }

  // Gates (send-time check; schedule-time check happened when the row was created on an earlier tick).
  const tz = profile.timezone;
  const dayStart = instantAtLocal(today, profile.rollover_hour, 0, tz).toISOString();
  const weekStart = new Date(Date.parse(dayStart) - 6 * 86400000).toISOString();
  const [consentRes, todayCountRes, weekCountRes, lastMissedRes, eventRes] = await Promise.all([
    svc.from("consents").select("enabled").eq("user_id", profile.user_id).eq("category", c.trigger).maybeSingle(),
    svc.from("reminder_log").select("id", { count: "exact", head: true }).eq("user_id", profile.user_id).eq("status", "sent").gte("sent_at", dayStart),
    svc.from("reminder_log").select("id", { count: "exact", head: true }).eq("user_id", profile.user_id).eq("status", "sent").gte("sent_at", weekStart),
    svc.from("reminder_log").select("sent_at").eq("user_id", profile.user_id).eq("trigger", "missed_log").eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    c.eventId ? svc.from("events").select("status").eq("id", c.eventId).maybeSingle() : Promise.resolve({ data: { status: "active" } }),
  ]);
  const gateErrors = [consentRes, todayCountRes, weekCountRes, lastMissedRes, eventRes]
    .map((r) => (r as { error?: { message: string } | null }).error?.message)
    .filter((m): m is string => Boolean(m));
  if (gateErrors.length) {
    // A gate we cannot evaluate is a gate that fails. Leave the row pending for the next tick.
    return { ...base, status: "pending", block_reason: `GATE_QUERY_ERROR: ${gateErrors[0]}` };
  }
  const lastOpened = profile.last_opened_at ? new Date(profile.last_opened_at) : null;
  const trace = evaluateGates({
    now,
    tz,
    quietStart: profile.quiet_start,
    quietEnd: profile.quiet_end,
    consentEnabled: consentRes.data?.enabled !== false,
    apnsTokenPresent: Boolean(profile.apns_token) || forceApns,
    pushesSentToday: toNumber(todayCountRes.count, 0),
    pushesSentThisWeek: toNumber(weekCountRes.count, 0),
    eventStillActive: (eventRes.data?.status ?? "active") === "active",
    scheduledFor: c.scheduledFor,
    lastMissedLogSentAt: lastMissedRes.data?.sent_at ? new Date(lastMissedRes.data.sent_at as string) : null,
    openedAppToday: lastOpened ? serviceDate(lastOpened, tz, profile.rollover_hour) === today : false,
    trigger: c.trigger,
  });

  if (!trace.allowed) {
    const retryable = trace.blockedBy === "QUIET_HOURS" || trace.blockedBy === "APNS_TOKEN";
    const status = trace.blockedBy === "STALE" ? "stale" : retryable ? "pending" : "blocked";
    if (rowId && !dryRun) {
      await svc.from("reminder_log").update({ status, block_reason: blockedCode(trace), gate_trace: trace }).eq("id", rowId);
    }
    return { ...base, status, block_reason: blockedCode(trace), gate_trace: trace };
  }

  if (dryRun) return { ...base, status: "dry_run", gate_trace: trace };

  // Claim the row atomically so an overlapping tick cannot send it too.
  if (rowId) {
    const { data: claimed, error: claimError } = await svc.rpc("claim_reminder", { p_id: rowId });
    if (claimError || claimed !== true) {
      return { ...base, status: "pending", block_reason: claimError ? `CLAIM_ERROR: ${claimError.message}` : "IN_FLIGHT", gate_trace: trace };
    }
  }

  // Send. The body is fixed text around code-inserted facts.
  const cfg = apnsConfigFromEnv(env);
  let apns: CandidateReport["apns"] = null;
  let status: CandidateReport["status"] = "sent";
  let blockReason: string | null = null;
  if (cfg && profile.apns_token) {
    const res = await sendPush(cfg, profile.apns_token, {
      title: c.title,
      body: c.body,
      threadId: c.trigger,
      category: PUSH_CATEGORY,
      data: { trigger: c.trigger, reminder_id: rowId ?? "", why_now: c.whyNow },
    });
    apns = { ok: res.ok, status: res.status, reason: res.reason };
    if (!res.ok) {
      status = "failed";
      blockReason = `APNS_${res.reason ?? res.status}`;
    }
  } else {
    // No APNs configured or no token: the row is marked sent so the gates and
    // dedupe still behave, and the app shows it as a local notification.
    apns = { ok: false, status: 0, reason: cfg ? "NO_DEVICE_TOKEN" : "APNS_NOT_CONFIGURED" };
    blockReason = apns.reason;
  }
  if (rowId) {
    await svc.from("reminder_log").update({
      status,
      sent_at: status === "sent" ? now.toISOString() : null,
      block_reason: blockReason,
      gate_trace: trace,
    }).eq("id", rowId);
  }
  return { ...base, status, block_reason: blockReason, gate_trace: trace, apns };
}
