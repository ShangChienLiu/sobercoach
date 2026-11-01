// chat: the reactive path, seven gates.
//  1 safety regex        -> fixed card, nothing written
//  2 breaker + clarify   -> code only
//  3 AGENTS (tools)      -> regex fast path or the small model; decides, never speaks
//  4 execute + verify    -> Postgres writes, then SQL recomputes the real figures
//  5 route the writer    -> strong writer for emotional, reflective or behavioral turns, within the daily cap
//  6 SOUL (words)        -> one plain-text pass with the verified state and the dreamed profile
//  7 guard               -> strip openers, drop unverified figures, one question, same language

import { auditCBand, guidelineFlags } from "../_shared/guidelines.ts";
import { CORS, currentUserId, env, jsonResponse, serviceClient, userClient } from "../_shared/db.ts";
import type { Db, DailyTotal } from "../_shared/db.ts";
import { toNumber } from "../_shared/db.ts";
import { detectSafety, SAFETY_TEXT, safetyTextForFlag } from "../_shared/safety.ts";
import { detectLang, looksLikeInjection, matchFaq, matchFastPath, preflightRoute } from "../_shared/tier0.ts";
import { buildTurnContext, loadDailyTotal, loadProfile, loadWeekly, renderContext, type TurnContext } from "../_shared/context.ts";
import { instantAtLocal, serviceDate } from "../_shared/service_day.ts";
import { callStructured, OpenRouterError } from "../_shared/openrouter.ts";
import { ENVELOPE_SCHEMA, type Envelope, type Intent, STRONG_ADDENDUM, SYSTEM_PROMPT } from "../_shared/prompt.ts";
import { modelChainFor, modelForTier } from "../_shared/pricing.ts";
import { correctEntry, type EntryCard, executeTool, logDrink, renderSummaryLine, type ToolOutcome, undoEntry } from "../_shared/tools_exec.ts";
import type { WeeklyTotals } from "../_shared/context.ts";
import { globalSpendLast24h, type LedgerTier, strongCallsSince, touchLastOpened, userSpendSince, writeLedger } from "../_shared/ledger.ts";
import { parseCount, stdDrinksNominal } from "../_shared/drinks.ts";
import { cardFor } from "../_shared/tools_exec.ts";
import { normalizeEntry } from "../_shared/context.ts";
import { validateEnvelope } from "../_shared/envelope.ts";
import { mockEnvelope } from "../_shared/mock_model.ts";
import { allowedNumbers, fallbackWarmReply, mockSoulLine, postProcessSoulReply, reasoningFor, shouldEscalateToSonnet, usedHooks, type VerifiedState, writeSoulReply, writerPlan } from "../_shared/soul.ts";
import { DREAM_EVERY_TURNS, runDreamPass } from "../_shared/dream.ts";
import { labelEventTime, labelServiceDate, localParts } from "../_shared/service_day.ts";
import { beverageLabel } from "../_shared/drinks.ts";

// --- request / response types ---------------------------------------------------

type ClientAction =
  | { type: "quick_log"; beverage: string; count: number; volume_ml?: number | null; abv?: number | null }
  | { type: "undo"; entry_id?: string | null }
  | { type: "apply_size"; entry_id: string; volume_ml: number; abv: number }
  | { type: "mark_dry"; relative_day?: "today" | "yesterday" }
  | { type: "choose_entry"; entry_id: string; original_message: string }
  | { type: "reset_test_data" };

interface ChatRequest {
  message?: string;
  action?: ClientAction;
  client_now?: string;
  /** The device's current IANA timezone, sent on every request; the turn is read in it and the profile follows it. */
  client_timezone?: string;
  debug?: { simulate_outage?: boolean };
}

function validTimezone(tz: unknown): string | null {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

interface ClarifyOption {
  entry_id: string;
  label: string;
}

interface ChatState {
  weekly_total: number;
  weekly_remaining: number;
  weekly_limit: number;
  has_nominal: boolean;
  today: number | "NO_DATA" | "DRY";
  today_service_date: string;
  strong_calls_today: number;
  strong_cap: number;
  spend_today_usd: number;
  daily_budget_usd: number;
}

interface ChatData {
  reply: string;
  tier: LedgerTier;
  model: string | null;
  route_reason: string;
  card: EntryCard | null;
  clarify: { question: string; options: ClarifyOption[] } | null;
  safety: "crisis" | "withdrawal" | "driving" | null;
  state: ChatState;
  cost_usd: number;
  latency_ms: number;
}

const STRONG_CAP = Number(env("STRONG_CALLS_PER_USER_PER_DAY") ?? "10");
const GLOBAL_BREAKER_USD = Number(env("GLOBAL_DAILY_SPEND_USD") ?? "25");
/** Per-user daily model budget; past it the writer drops to the budget model and nothing escalates. $0.15 a day is the $4.50 monthly ceiling. */
const USER_BUDGET_USD = Number(env("USER_MODEL_BUDGET_USD_PER_DAY") ?? "0.15");
/** Marker appended to route_reason whenever a strong model is called; the daily cap counts it. */
export const STRONG_CALL_MARK = "strong_call";

/** Runs a direct tool call and converts thrown errors into a failed outcome instead of a 500. */
async function safely(name: string, fallbackKind: ToolOutcome["fallbackKind"], fn: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await fn();
  } catch (error: unknown) {
    return { name, ok: false, error: error instanceof Error ? error.message : "unknown error", fallbackKind };
  }
}

const OUTAGE_TEXT = "I'm having trouble reaching my coach brain right now. Quick-log buttons and one-line logs like \"2 beers\" still work, and your data is safe.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "POST only" }, 405);
  const started = Date.now();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ success: false, error: "missing auth" }, 401);
  const db = userClient(authHeader);
  const userId = await currentUserId(db);
  if (!userId) return jsonResponse({ success: false, error: "invalid session" }, 401);

  let body: ChatRequest;
  try {
    body = await req.json() as ChatRequest;
  } catch {
    return jsonResponse({ success: false, error: "invalid JSON" }, 400);
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!message && !body.action) return jsonResponse({ success: false, error: "message or action required" }, 400);

  const svc = serviceClient();
  try {
    const profile = await loadProfile(db, userId);
    if (!profile.age_confirmed) return jsonResponse({ success: false, error: "age not confirmed" }, 403);
    const now = profile.is_test && body.client_now && !Number.isNaN(Date.parse(body.client_now)) ? new Date(body.client_now) : new Date();
    const simulateOutage = profile.is_test && body.debug?.simulate_outage === true;
    // Timezone is an environment of the request, not a property of the account: a traveller's "today" moves with the device.
    const clientTz = validTimezone(body.client_timezone);
    if (clientTz && clientTz !== profile.timezone) {
      await svc.from("profiles").update({ timezone: clientTz }).eq("user_id", userId);
    }
    await touchLastOpened(db, userId);

    const data = await handleTurn({ db, svc, userId, now, message, action: body.action ?? null, simulateOutage, started });
    return jsonResponse({ success: true, data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unexpected error";
    console.error("chat failed", msg);
    return jsonResponse({ success: false, error: "Something went wrong on our side. Nothing was changed." }, 500);
  }
});

interface TurnInput {
  db: Db;
  svc: Db;
  userId: string;
  now: Date;
  message: string;
  action: ClientAction | null;
  simulateOutage: boolean;
  started: number;
}

async function handleTurn(input: TurnInput): Promise<ChatData> {
  const { db, svc, userId, now, message, action } = input;
  const profile = await loadProfile(db, userId);
  const todayService = serviceDate(now, profile.timezone, profile.rollover_hour);
  const dayStartIso = instantAtLocal(todayService, profile.rollover_hour, 0, profile.timezone).toISOString();
  const [strongToday, spendToday] = await Promise.all([strongCallsSince(svc, userId, dayStartIso), userSpendSince(svc, userId, dayStartIso)]);
  const built = await buildTurnContext(db, userId, now, strongToday, spendToday);
  const ctx: TurnContext = { ...built, lang: detectLang(message || built.lastMessages.at(-1)?.content || ""), userMessage: message || undefined };

  // Structured client actions never touch a model.
  if (action) return await handleAction(input, ctx, action);

  await writeLedger(svc, { user_id: userId, role: "user", content: message });

  // Tier-0 #1: safety regex.
  const safety = detectSafety(message);
  if (safety) {
    const reply = SAFETY_TEXT[safety.kind];
    await writeLedger(svc, { user_id: userId, role: "assistant", content: reply, tier: "tier0_safety", route_reason: `safety_regex:${safety.kind}`, risk_flag: true, latency_ms: Date.now() - input.started });
    return finish(ctx, reply, "tier0_safety", null, `safety_regex:${safety.kind}`, null, null, safety.kind, 0, input.started);
  }

  // Tier-0 #1b: static facts, answered by code in the user's language.
  const faq = matchFaq(message);
  if (faq) {
    await writeLedger(svc, { user_id: userId, role: "assistant", content: faq.reply, tier: "tier0_fastpath", route_reason: `faq:${faq.key}`, latency_ms: Date.now() - input.started });
    return finish(ctx, faq.reply, "tier0_fastpath", null, `faq:${faq.key}`, null, null, null, 0, input.started);
  }

  // Outage or spend breaker: Tier-0 only.
  const spend = await globalSpendLast24h(svc);
  if (input.simulateOutage || spend >= GLOBAL_BREAKER_USD) {
    const reason = input.simulateOutage ? "simulated_outage" : "global_spend_breaker";
    // The fast path still writes during an outage; only the words are fixed.
    const fast = matchFastPath(message);
    if (fast) {
      const outcome = await runFastPath(db, ctx, fast);
      return await finishTurn(input, ctx, [outcome], "", "tier0_fastpath", null, `fastpath:${fast.kind}+${reason}`, 0);
    }
    const text = input.simulateOutage
      ? "Sandbox: model outage is simulated, so chat answers with fixed text only. Quick-log buttons and one-line logs like \"2 beers\" still work. Turn it off in the wrench menu."
      : OUTAGE_TEXT;
    await writeLedger(svc, { user_id: userId, role: "assistant", content: text, tier: "fallback_fixed", route_reason: reason, latency_ms: Date.now() - input.started });
    return finish(ctx, text, "fallback_fixed", null, reason, null, null, null, 0, input.started);
  }

  // Gate 2b: ambiguous correction target -> ask, write nothing, call nothing.
  const pre = preflightRoute(message, ctx.recent48h);
  if (pre?.route === "clarify") {
    const candidates = ctx.recent48h.filter((e) => e.status === "active" && (pre.beverage === "drink" || e.beverage === pre.beverage));
    const clarify = clarifyFromEntries(ctx, "Which one do you mean?", candidates.map((e) => e.id));
    const reply = clarify.question;
    await writeLedger(svc, { user_id: userId, role: "assistant", content: reply, tier: "fallback_fixed", route_reason: pre.reason, latency_ms: Date.now() - input.started });
    return finish(ctx, reply, "fallback_fixed", null, pre.reason, null, clarify, null, 0, input.started);
  }

  // Gate 3: AGENTS. The regex fast path turns a plain log into a tool call at $0;
  // everything else goes to the small model, which decides tools and labels intent.
  let outcomes: ToolOutcome[] = [];
  let intent: Intent;
  let tier: LedgerTier = "tier0_fastpath";
  let routeReason: string;
  let cost = 0;
  let modelUsed: string | null = null;
  let tokens = { prompt_tokens: 0, cached_tokens: 0, completion_tokens: 0 };
  let toolCalls: unknown = null;

  const fast = matchFastPath(message);
  if (fast) {
    outcomes = [await runFastPath(db, ctx, fast)];
    intent = fast.kind === "undo" ? "edit" : "log";
    routeReason = `fastpath:${fast.kind}`;
  } else {
    const injection = looksLikeInjection(message);
    const preHint: Intent | null = pre?.reason === "preflight_emotional" ? "emotional" : pre?.reason === "preflight_reflection" ? "reflect" : null;
    let toolTier: "small" | "strong" = pre?.route === "strong" && pre.reason === "preflight_multi_entry" ? "strong" : "small";
    routeReason = pre?.reason ?? (injection ? "injection_guard" : "default_small");
    const overBudget = ctx.spendTodayUsd >= USER_BUDGET_USD;
    if (toolTier === "strong" && (ctx.strongCallsToday >= STRONG_CAP || overBudget)) {
      toolTier = "small";
      routeReason = `${routeReason}+${overBudget ? "budget_capped" : "strong_capped"}`;
    }
    if (toolTier === "strong") routeReason = `${routeReason}+${STRONG_CALL_MARK}`;
    let result = await callModel(ctx, toolTier, message);
    let envelope = result.ok ? validateEnvelope(result.value.parsed) : null;
    cost = result.ok ? result.value.costUsd : 0;
    modelUsed = result.ok ? result.value.model : null;
    tokens = result.ok ? result.value.usage : tokens;

    // Escalation: the small model asked, or its output failed validation.
    const wantsEscalation = envelope?.tool_calls.some((t) => t.name === "escalate") ?? false;
    if (toolTier === "small" && (!envelope || wantsEscalation)) {
      if (overBudget) {
        routeReason = `${routeReason}+budget_capped`;
      } else if (ctx.strongCallsToday < STRONG_CAP) {
        const why = !envelope ? "small_schema_invalid" : `small_escalate:${String(envelope.tool_calls.find((t) => t.name === "escalate")?.args.text ?? envelope.tool_calls.find((t) => t.name === "escalate")?.args.reason ?? "")}`;
        routeReason = `${why}+${STRONG_CALL_MARK}`;
        const second = await callModel(ctx, "strong", message);
        if (second.ok) {
          cost += second.value.costUsd;
          tokens = sumUsage(tokens, second.value.usage);
          modelUsed = second.value.model;
          const env2 = validateEnvelope(second.value.parsed);
          if (env2) {
            toolTier = "strong";
            envelope = env2;
            result = second;
          } else {
            routeReason = `${routeReason}+strong_invalid`;
          }
        } else {
          routeReason = `${routeReason}+strong_failed`;
        }
      } else {
        routeReason = `${routeReason}+strong_capped`;
      }
    }

    if (!envelope) {
      const errKind = result.ok ? "schema" : result.error.includes("truncated") ? "truncated" : /HTTP (\d+)/.exec(result.error)?.[1] ?? "network";
      routeReason = `${routeReason}+model_error:${errKind}`;
      const reply = result.ok ? "I didn't quite get that. Try \"2 beers\" or tell me what to change." : OUTAGE_TEXT;
      await writeLedger(svc, { user_id: userId, role: "assistant", content: reply, tier: "fallback_fixed", model: modelUsed ?? undefined, route_reason: `${routeReason}+invalid_output`, cost_usd: cost, latency_ms: Date.now() - input.started });
      return finish(ctx, reply, "fallback_fixed", modelUsed, `${routeReason}+invalid_output`, null, null, null, cost, input.started);
    }
    tier = toolTier;
    toolCalls = envelope.tool_calls;

    // Model-flagged risk: fixed text, no writes.
    if (envelope.risk_flag) {
      const reply = safetyTextForFlag(message);
      await writeLedger(svc, { user_id: userId, role: "assistant", content: reply, tier, model: modelUsed ?? undefined, route_reason: `${routeReason}+risk_flag`, risk_flag: true, cost_usd: cost, tokens_in: tokens.prompt_tokens, tokens_cached: tokens.cached_tokens, tokens_out: tokens.completion_tokens, latency_ms: Date.now() - input.started });
      return finish(ctx, reply, tier, modelUsed, `${routeReason}+risk_flag`, null, null, detectSafety(message)?.kind ?? "withdrawal", cost, input.started);
    }

    // Clarify: nothing is written yet. Only ids that exist in the 48 h context count.
    if (envelope.clarify) {
      const clarify = clarifyFromEntries(ctx, envelope.clarify.question, envelope.clarify.option_entry_ids);
      if (clarify.options.length >= 2) {
        await writeLedger(svc, { user_id: userId, role: "assistant", content: clarify.question, tier, model: modelUsed ?? undefined, route_reason: `${routeReason}+clarify`, cost_usd: cost, tokens_in: tokens.prompt_tokens, tokens_cached: tokens.cached_tokens, tokens_out: tokens.completion_tokens, latency_ms: Date.now() - input.started });
        return finish(ctx, clarify.question, tier, modelUsed, `${routeReason}+clarify`, null, clarify, null, cost, input.started);
      }
      routeReason = `${routeReason}+clarify_dropped`;
    }

    // The regex hint wins over the model's label for the hard moments; the model's label fills the rest.
    intent = preHint ?? envelope.intent;

    // Gate 4a: execute tools in order (escalate is a no-op here).
    for (const call of envelope.tool_calls.filter((t) => t.name !== "escalate")) {
      outcomes.push(await executeTool(db, ctx, call));
    }
  }

  return await finishTurn(input, ctx, outcomes, message, tier, modelUsed, routeReason, cost, tokens, toolCalls, intent);
}

async function runFastPath(db: Db, ctx: TurnContext, fast: NonNullable<ReturnType<typeof matchFastPath>>): Promise<ToolOutcome> {
  return fast.kind === "undo"
    ? await safely("undo_entry", "undone", () => undoEntry(db, ctx, null))
    : await safely("log_drink", "logged", () => logDrink(db, ctx, { count: fast.count, beverage: fast.beverage, relative_day: fast.relative_day }, "regex"));
}

// --- client actions ------------------------------------------------------------------

async function handleAction(input: TurnInput, ctx: TurnContext, action: ClientAction): Promise<ChatData> {
  const { db } = input;
  switch (action.type) {
    case "reset_test_data": {
      // Test accounts only: wipe own entries, events, ledger and reminders so a reviewer starts clean.
      if (!ctx.profile.is_test) return finish(ctx, "Only test accounts can reset.", "fallback_fixed", null, "action:reset_denied", null, null, null, 0, input.started);
      await db.from("drink_entries").delete().eq("user_id", ctx.userId);
      await db.from("events").delete().eq("user_id", ctx.userId);
      await input.svc.from("messages").delete().eq("user_id", ctx.userId);
      await input.svc.from("reminder_log").delete().eq("user_id", ctx.userId);
      await db.from("consents").update({ enabled: true }).eq("user_id", ctx.userId);
      await input.svc.from("coach_memory").upsert({ user_id: ctx.userId, summary: "", updated_at: new Date().toISOString() });
      await input.svc.from("profiles").update({ soul_profile: "", soul_profile_updated_at: null, turns_since_dream: 0 }).eq("user_id", ctx.userId);
      const fresh = await buildTurnContext(db, ctx.userId, ctx.now, 0);
      return finish(fresh, "Test data reset: entries, events, ledger, reminders, memory and profile cleared; reminders back on; strong-model count back to 0.", "tier0_fastpath", null, "action:reset_test_data", null, null, null, 0, input.started);
    }
    case "quick_log": {
      const outcome = await safely("log_drink", "logged", () =>
        logDrink(db, ctx, {
          count: action.count,
          beverage: action.beverage,
          volume_ml: action.volume_ml ?? null,
          abv: action.abv ?? null,
          relative_day: "today",
        }, "quick_log"));
      return await finishTurn(input, ctx, [outcome], "", "tier0_fastpath", null, "action:quick_log", 0);
    }
    case "undo": {
      const outcome = await safely("undo_entry", "undone", () => undoEntry(db, ctx, action.entry_id ?? null));
      return await finishTurn(input, ctx, [outcome], "", "tier0_fastpath", null, "action:undo", 0);
    }
    case "apply_size": {
      const outcome = await safely("correct_entry", "corrected", () =>
        correctEntry(db, ctx, { entry_id: action.entry_id, volume_ml: action.volume_ml, abv: action.abv }));
      return await finishTurn(input, ctx, [outcome], "", "tier0_fastpath", null, "action:apply_size", 0);
    }
    case "mark_dry": {
      const outcome = await safely("mark_dry", "generic", () => markDry(db, ctx, action.relative_day ?? "today"));
      return await finishTurn(input, ctx, [outcome], "", "tier0_fastpath", null, "action:mark_dry", 0);
    }
    case "choose_entry": {
      // Deterministic only when the new count clearly follows a change verb
      // ("to 1", "make it 1", "was 2"); otherwise a small-model pass with the chosen id.
      const m = /\b(?:to|make (?:it|that)|was|should be|it'?s|only)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(action.original_message);
      const count = m ? parseCount(m[1]) : null;
      if (count != null) {
        const outcome = await safely("correct_entry", "corrected", () => correctEntry(db, ctx, { entry_id: action.entry_id, count }));
        return await finishTurn(input, ctx, [outcome], action.original_message, "tier0_fastpath", null, "action:choose_entry", 0, undefined, null, "edit");
      }
      const hinted = `${action.original_message}\n(The user chose entry id=${action.entry_id}. Apply the change to that entry only.)`;
      const res = await callModel(ctx, "small", hinted);
      const envlp = res.ok ? validateEnvelope(res.value.parsed) : null;
      if (!envlp) {
        return finish(ctx, "I couldn't apply that. Tell me the new count, like \"make it 1\".", "fallback_fixed", null, "action:choose_entry+invalid", null, null, null, 0, input.started);
      }
      const outcomes: ToolOutcome[] = [];
      for (const call of envlp.tool_calls.filter((t) => t.name === "correct_entry" || t.name === "undo_entry")) {
        outcomes.push(await executeTool(db, ctx, { ...call, args: { ...call.args, entry_id: action.entry_id } }));
      }
      return await finishTurn(input, ctx, outcomes, action.original_message, "small", res.ok ? res.value.model : null, "action:choose_entry", res.ok ? res.value.costUsd : 0, res.ok ? res.value.usage : undefined, envlp.tool_calls, "edit");
    }
  }
}

async function markDry(db: Db, ctx: TurnContext, rel: "today" | "yesterday"): Promise<ToolOutcome> {
  const day = rel === "today" ? ctx.todayService : new Date(Date.parse(ctx.todayService) - 86400000).toISOString().slice(0, 10);
  const occurred = instantAtLocal(day, 21, 0, ctx.profile.timezone).toISOString();
  const { data, error } = await db.from("drink_entries").insert({
    user_id: ctx.userId,
    occurred_at: occurred,
    service_date: day,
    beverage: "drink",
    count: 0,
    std_drinks_nominal: stdDrinksNominal(0),
    status: "confirmed_dry",
    source: "quick_log",
  }).select("*").single();
  if (error || !data) return { name: "mark_dry", ok: false, error: error?.message ?? "insert failed", fallbackKind: "generic" };
  const entry = normalizeEntry(data);
  return {
    name: "mark_dry",
    ok: true,
    fallbackKind: "generic",
    confirmation: `Marked ${entry.service_date === ctx.todayService ? "today" : "yesterday"} as a dry day.`,
    card: cardFor(entry, ctx.profile.timezone),
  };
}

// --- model call ---------------------------------------------------------------------

type ModelResult =
  | { ok: true; value: Awaited<ReturnType<typeof callStructured<Envelope>>> }
  | { ok: false; error: string };

/** Gate 3 model pass: tools and the intent label, nothing else. */
async function callModel(ctx: TurnContext, tier: "small" | "strong", message: string): Promise<ModelResult> {
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not configured" };
  if (apiKey === "mock") {
    // Deterministic local stand-in; exercises orchestration with no vendor key.
    return { ok: true, value: mockEnvelope(ctx, tier, message) };
  }
  const route = modelForTier(tier, env);
  const models = modelChainFor(tier, env);
  const providerOrder = (env(tier === "strong" ? "STRONG_PROVIDER_ORDER" : "SMALL_PROVIDER_ORDER") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const systemText = SYSTEM_PROMPT + (tier === "strong" ? STRONG_ADDENDUM : "");
  const userText = `${renderContext(ctx)}\n\n## user_message\n${message}`;

  try {
    const value = await callStructured<Envelope>({ apiKey }, {
      models,
      providerOrder,
      sessionId: ctx.userId,
      maxTokens: tier === "strong" ? 1000 : 900,
      // The envelope is a decision, not prose: Sonnet must not think at default effort on it.
      reasoning: tier === "strong" ? reasoningFor(models[0]) : undefined,
      schema: ENVELOPE_SCHEMA as unknown as { name: string; strict: boolean; schema: Record<string, unknown> },
      messages: [
        { role: "system", content: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }] },
        { role: "user", content: userText },
      ],
    });
    return { ok: true, value };
  } catch (error: unknown) {
    const msg = error instanceof OpenRouterError ? `${error.message} ${error.body ?? ""}` : error instanceof Error ? error.message : "unknown";
    console.error("model call failed", tier, msg);
    return { ok: false, error: msg };
  }
}

function sumUsage(a: { prompt_tokens: number; cached_tokens: number; completion_tokens: number }, b: typeof a): typeof a {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    cached_tokens: a.cached_tokens + b.cached_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
  };
}

// --- finishing -------------------------------------------------------------------------

function clarifyFromEntries(ctx: TurnContext, question: string, ids: string[]): { question: string; options: ClarifyOption[] } {
  const options = ids
    .map((id) => ctx.recent48h.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .map((e) => {
      const t = new Intl.DateTimeFormat("en-US", { timeZone: ctx.profile.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(e.occurred_at));
      return { entry_id: e.id, label: `${e.count} × ${e.beverage} · ${t}` };
    });
  return { question, options };
}

/** Gate 4b: SQL recomputes everything the writer may cite. */
async function verifiedStateFor(
  db: Db,
  ctx: TurnContext,
  profile: TurnContext["profile"],
  weekly: WeeklyTotals,
  today: DailyTotal | null,
  succeeded: ToolOutcome[],
  confirmations: string[],
  factLine: string | null,
): Promise<VerifiedState> {
  const tz = profile.timezone;
  const lp = localParts(ctx.now, tz);
  const since2h = new Date(ctx.now.getTime() - 2 * 3600 * 1000).toISOString();
  const { data: recent } = await db.from("drink_entries").select("count").eq("user_id", ctx.userId).eq("status", "active").gte("occurred_at", since2h).lte("occurred_at", new Date(ctx.now.getTime() + 60_000).toISOString());
  const entriesLast2h = recent?.length ?? 0;
  const drinksLast2h = (recent ?? []).reduce((s, r) => s + toNumber(r.count), 0);
  const loggedOutcome = succeeded.find((o) => o.name === "log_drink" && o.card);
  const logged = loggedOutcome?.card
    ? {
      count: loggedOutcome.card.count,
      beverage: ctx.lang === "zh" ? loggedOutcome.card.beverage : beverageLabel(loggedOutcome.card.beverage, loggedOutcome.card.count),
      dayLabel: labelServiceDate(loggedOutcome.card.service_date, tz, ctx.lang),
      std: loggedOutcome.card.std_drinks,
      estimated: loggedOutcome.card.is_estimate,
    }
    : null;
  const ev = ctx.events[0];
  const nextEvent = ev
    ? {
      title: ev.title,
      whenLabel: labelEventTime(ev.starts_at, tz, ctx.lang),
      daysUntil: Math.max(0, Math.round((Date.parse(labelDay(ev.starts_at, tz)) - Date.parse(ctx.todayService)) / 86400000)),
      hoursUntil: Math.max(0, Math.round((Date.parse(ev.starts_at) - ctx.now.getTime()) / 3600000)),
    }
    : null;
  const sex = profile.sex_for_guidelines ?? null;
  const guideline = guidelineFlags({ sex, drinksLast2h, todayTotal: today ? today.std_drinks : null, weeklyTotal: weekly.stdDrinks, weeklyLimit: profile.weekly_limit });
  const screening = profile.audit_c_score != null ? { score: profile.audit_c_score, band: auditCBand(profile.audit_c_score, sex) } : null;
  return {
    lang: ctx.lang,
    guideline,
    screening,
    localHour: lp.hour,
    weekday: lp.weekday,
    weeklyTotal: weekly.stdDrinks,
    weeklyLimit: profile.weekly_limit,
    weeklyRemaining: Math.round((profile.weekly_limit - weekly.stdDrinks) * 10) / 10,
    weeklyEstimated: weekly.hasNominal,
    daysWithData: weekly.daysWithData,
    todayTotal: today ? today.std_drinks : null,
    todayDry: Boolean(today?.confirmed_dry && today.active_entries === 0),
    entriesLast2h,
    drinksLast2h,
    logged,
    nextEvent,
    summary: succeeded.find((o) => o.summary)?.summary ?? null,
    factLine,
    confirmations,
  };
}

function labelDay(iso: string, tz: string): string {
  const p = localParts(new Date(iso), tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Gates 4b to 7. Commits are done; recompute the real figures, pick the writer,
 * write the words with the verified state, guard them, record the turn.
 * `userMessage` empty means a button action: receipt only, no writer.
 */
async function finishTurn(
  input: TurnInput,
  ctx: TurnContext,
  outcomes: ToolOutcome[],
  userMessage: string,
  tier: LedgerTier,
  model: string | null,
  routeReason: string,
  cost: number,
  tokens: { prompt_tokens: number; cached_tokens: number; completion_tokens: number } = { prompt_tokens: 0, cached_tokens: 0, completion_tokens: 0 },
  toolCalls: unknown = null,
  intent: Intent = "chat",
): Promise<ChatData> {
  const { db, svc, userId } = input;
  const failed = outcomes.filter((o) => !o.ok);
  const succeeded = outcomes.filter((o) => o.ok);

  // Fresh numbers after the commit, including a possibly changed weekly limit.
  const profile = await loadProfile(db, userId).catch(() => ctx.profile);
  const ctx2: TurnContext = { ...ctx, profile };
  const weekly = await loadWeekly(db, userId, ctx.todayService, profile.weekly_limit);
  const today = await loadDailyTotal(db, userId, ctx.todayService);

  const confirmations = succeeded.map((o) => o.confirmation).filter((c): c is string => Boolean(c));
  const summaryOutcome = succeeded.find((o) => o.summary);
  if (summaryOutcome?.summary) confirmations.unshift(renderSummaryLine(summaryOutcome.summary, profile.timezone, ctx.lang));
  const followupOutcome = succeeded.find((o) => o.followup);
  const factLine = followupOutcome?.followup?.line ?? null;
  if (factLine) confirmations.unshift(factLine);

  const card = succeeded.find((o) => o.card)?.card ?? null;
  let line = "";
  let modelUsed = model;
  if (failed.length) {
    // Any failure drops the writer; code states exactly what was not written.
    const notes = failed.map((f) => `${f.name.replace("_", " ")}: ${f.error ?? "unknown error"}`).join("; ");
    line = succeeded.length
      ? `I couldn't apply the rest (${notes}). Tell me again or tap Undo if needed.`
      : `I couldn't make that change (${notes}). Nothing was written. Tap retry or tell me again.`;
    routeReason = `${routeReason}+tool_failed`;
  } else if (userMessage) {
    // Gates 5 to 7: the words, for typed messages only.
    const state = await verifiedStateFor(db, ctx2, profile, weekly, today, succeeded, confirmations, factLine);
    const wrote = succeeded.some((o) => ["log_drink", "correct_entry", "undo_entry", "add_event", "update_event", "set_goal", "set_reminder_pref", "mark_dry"].includes(o.name));
    const strongUsedThisTurn = routeReason.includes(STRONG_CALL_MARK) ? 1 : 0;
    const overBudget = ctx.spendTodayUsd + cost >= USER_BUDGET_USD;
    const route = shouldEscalateToSonnet({ intent, state, wrote, dailyStrongCount: ctx.strongCallsToday + strongUsedThisTurn, cap: STRONG_CAP, overBudget });
    const writerLabel = route.escalate ? `strong:${route.reason}` : route.reason === "budget" ? "light:budget" : route.reason === "strong_capped" ? "light:capped" : "light";
    routeReason = `${routeReason}+soul:${writerLabel}`;
    if (route.escalate) routeReason = `${routeReason}+${STRONG_CALL_MARK}`;
    const apiKey = env("OPENROUTER_API_KEY") ?? "";
    const allowed = allowedNumbers(state, userMessage, ctx.memory, profile.soul_profile ?? "", ...ctx.events.map((e) => e.title));
    let raw: string | null = null;
    if (apiKey === "mock") {
      raw = mockSoulLine(state, intent);
      modelUsed = modelUsed ?? "mock/soul";
    } else if (apiKey) {
      // Strong turns: SOUL_MODEL at SOUL_STRONG_REASONING. Routine: SOUL_LIGHT_MODEL (small talk: SOUL_CHAT_MODEL). Over budget: SOUL_BUDGET_MODEL.
      const plan = writerPlan({ escalate: route.escalate, intent, overBudget, env });
      const soul = await writeSoulReply({ apiKey, plan }, {
        state,
        intent,
        userMessage,
        soulProfile: profile.soul_profile ?? "",
        memory: ctx.memory,
        history: ctx.lastMessages,
      }, userId);
      if (soul) {
        cost += soul.costUsd;
        tokens = sumUsage(tokens, soul.usage);
        modelUsed = soul.model;
        // A cut-off line with no text at all goes to code; partial text still gets guarded.
        raw = soul.finishReason === "length" && !soul.text.trim() ? null : soul.text;
        if (raw == null) routeReason = `${routeReason}+soul_truncated`;
      } else {
        routeReason = `${routeReason}+soul_failed`;
      }
    }
    if (raw != null) {
      const recentCoach = ctx.lastMessages.filter((m) => m.role === "assistant").slice(-3).map((m) => m.content);
      const hard = intent === "emotional" || intent === "reflect";
      const routineWrite = !hard && wrote && (intent === "log" || intent === "edit");
      const guarded = postProcessSoulReply(raw, allowed, ctx.lang, confirmations, hard ? 3 : 2, usedHooks(recentCoach), routineWrite ? 0 : 1);
      if (guarded.note) routeReason = `${routeReason}+guard:${guarded.note}`;
      line = guarded.text;
    }
    if (!line) {
      // A setting, event or reminder change already has code's receipt in front; the receipt alone beats a generic line.
      const settingWrite = wrote && confirmations.length > 0 && !card && intent !== "emotional" && intent !== "reflect";
      line = settingWrite ? "" : fallbackWarmReply(state, intent);
      routeReason = `${routeReason}+soul_fallback`;
    }
    // The ledger tier is the highest model that took part in the turn.
    if (route.escalate && modelUsed) tier = "strong";
    else if (tier === "tier0_fastpath" && modelUsed) tier = "small";
  } else if (weekly.pctOfLimit >= 0.8 && succeeded.some((o) => o.name === "log_drink" || o.name === "correct_entry")) {
    // Button actions stay receipt-only; a short code banner marks a week near or past its limit.
    const pct = Math.round(weekly.pctOfLimit * 100);
    line = ctx.lang === "zh"
      ? (pct >= 100 ? "這週已經超過上限了。" : `這週用掉 ${pct}% 了。`)
      : (pct >= 100 ? "That's past this week's limit." : `That's ${pct}% of the week's limit.`);
  }
  // Typed messages with a usable writer line read as one voice: the receipt lives in the card
  // (count, drink, service day, Undo) and in the ledger, not as a second sentence in the bubble.
  // Fact lines (summary, reminders), failures and button actions keep code's text in front.
  // Only entry writes have a card to carry the receipt; events, limits and reminder settings keep their line.
  const receiptOnly = confirmations.length > 0 && !factLine && !summaryOutcome?.summary && card != null;
  const hideReceipt = Boolean(userMessage) && !failed.length && Boolean(line) && receiptOnly && !routeReason.includes("soul_fallback");
  const full = [...confirmations, line].filter(Boolean).join(" ").trim();
  const reply = hideReceipt ? line : full;
  if (hideReceipt) routeReason = `${routeReason}+receipt_in_card`;

  await writeLedger(svc, {
    user_id: userId,
    role: "assistant",
    content: full,
    tier,
    model: modelUsed ?? undefined,
    route_reason: routeReason,
    tool_calls: toolCalls ?? outcomes.map((o) => ({ name: o.name, ok: o.ok, error: o.error })),
    cost_usd: cost,
    tokens_in: tokens.prompt_tokens,
    tokens_cached: tokens.cached_tokens,
    tokens_out: tokens.completion_tokens,
    latency_ms: Date.now() - input.started,
  });
  if (userMessage) scheduleDream(input, profile.turns_since_dream ?? 0);
  return finish({ ...ctx2, weekly, today }, reply, tier, modelUsed, routeReason, card, null, null, cost, input.started);
}

/** Every few typed turns, consolidate memory in the background; the response never waits for it. */
function scheduleDream(input: TurnInput, turnsSoFar: number): void {
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) return;
  const turns = turnsSoFar + 1;
  const work = (async () => {
    if (turns < DREAM_EVERY_TURNS) {
      await input.svc.from("profiles").update({ turns_since_dream: turns }).eq("user_id", input.userId);
      return;
    }
    await runDreamPass(input.svc, input.userId, input.now, { apiKey, model: env("DREAM_MODEL") ?? modelForTier("small", env).id });
  })().catch((error: unknown) => console.error("dream schedule failed", error instanceof Error ? error.message : String(error)));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
}

function finish(
  ctx: TurnContext,
  reply: string,
  tier: LedgerTier,
  model: string | null,
  routeReason: string,
  card: EntryCard | null,
  clarify: { question: string; options: ClarifyOption[] } | null,
  safety: "crisis" | "withdrawal" | "driving" | null,
  cost: number,
  started: number,
): ChatData {
  return {
    reply,
    tier,
    model,
    route_reason: routeReason,
    card,
    clarify,
    safety,
    state: {
      weekly_total: ctx.weekly.stdDrinks,
      weekly_remaining: ctx.weekly.remaining,
      weekly_limit: ctx.profile.weekly_limit,
      has_nominal: ctx.weekly.hasNominal,
      today: ctx.today ? (ctx.today.confirmed_dry && ctx.today.active_entries === 0 ? "DRY" : ctx.today.std_drinks) : "NO_DATA",
      today_service_date: ctx.todayService,
      strong_calls_today: ctx.strongCallsToday,
      strong_cap: STRONG_CAP,
      spend_today_usd: Math.round(ctx.spendTodayUsd * 1e6) / 1e6,
      daily_budget_usd: USER_BUDGET_USD,
    },
    cost_usd: Math.round(cost * 1e6) / 1e6,
    latency_ms: Date.now() - started,
  };
}
