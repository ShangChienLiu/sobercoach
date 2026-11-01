// Acceptance-scenario runner. Signs in as a seeded test account, drives the
// chat and evaluate-triggers functions through the same OpenRouter routes
// production uses, checks database state after each step, and writes a
// results table (state accuracy, unsafe replies, p50/p95 latency, cost).
//
//   deno run -A eval/run.ts --url http://127.0.0.1:54321 --anon <anon_key> \
//     [--runs 3] [--paraphrases] [--only 1,2,6] [--label haiku-vs-luna]
//
// Required: supabase/seed.sql applied (alex@/blake@ test accounts).

import { parseArgs } from "jsr:@std/cli@1/parse-args";

interface StepExpect {
  active_entries_today?: number;
  active_entries_today_min?: number;
  entry_count?: number;
  tier_in?: string[];
  service_date?: "yesterday_calendar";
  service_date_shift?: number;
  reply_contains_date?: boolean;
  events_count?: number;
  report_status?: string;
  report_trigger?: string;
  report_blocked_by?: string;
  today_state?: string;
  consents_all_off?: boolean;
  entry_exact_null?: boolean;
  entry_nominal?: number;
  card_has_chips?: boolean;
  reply_contains?: string;
  reply_not_contains?: string;
  clarify_options_min?: number;
  writes_since_step?: number;
  route_reason_contains?: string;
  reply_numbers_match_view?: boolean;
  no_foreign_rows_visible?: boolean;
  safety?: string;
  safety_not_null?: boolean;
  strong_calls_today_max?: number;
}

interface Step {
  message?: string;
  action?: Record<string, unknown>;
  trigger?: { jump: "event_prep" | "quiet_days" | "morning_after" };
  debug?: { simulate_outage?: boolean };
  repeat?: number;
  expect?: StepExpect;
}

interface Scenario {
  id: number;
  title: string;
  client_now_local?: string;
  steps: Step[];
  paraphrases?: string[][];
}

interface Check {
  scenario: number;
  run: number;
  step: number;
  name: string;
  pass: boolean;
  detail: string;
}

const args = parseArgs(Deno.args, {
  string: ["url", "anon", "runs", "only", "label", "email", "password", "service"],
  boolean: ["paraphrases"],
  default: { runs: "1", email: "alex@test.sobercoach.app", password: "sobercoach-test", label: "default" },
});
const BASE = (args.url ?? Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = args.anon ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!ANON) {
  console.error("anon key required (--anon or SUPABASE_ANON_KEY)");
  Deno.exit(2);
}
const RUNS = Number(args.runs);
// Service-role key (local only) lets the harness clear the ledger and reminder
// log between runs; clients may only read those tables.
const SERVICE = args.service ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ONLY = args.only ? new Set(args.only.split(",").map(Number)) : null;

// --- minimal Supabase REST helpers -------------------------------------------------

async function signIn(email: string, password: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { token: j.access_token, userId: j.user.id };
}

function headers(token: string): Record<string, string> {
  return { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function rest<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`REST ${path} ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

async function restDelete(token: string, path: string): Promise<void> {
  await fetch(`${BASE}/rest/v1/${path}`, { method: "DELETE", headers: headers(token) });
}

async function restPatch(token: string, path: string, body: unknown): Promise<void> {
  await fetch(`${BASE}/rest/v1/${path}`, { method: "PATCH", headers: { ...headers(token), Prefer: "return=minimal" }, body: JSON.stringify(body) });
}

interface ChatData {
  reply: string;
  tier: string;
  model: string | null;
  route_reason: string;
  card: { size_chips?: unknown[]; service_date_label?: string; is_estimate?: boolean } | null;
  clarify: { options: unknown[] } | null;
  safety: string | null;
  state: { today: number | string; today_service_date: string; weekly_total: number; weekly_limit: number };
  cost_usd: number;
  latency_ms: number;
}

async function chat(token: string, body: Record<string, unknown>): Promise<ChatData> {
  // One retry on transport-level failures (5xx, gateway text), never on a 4xx or an envelope error.
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    const res = await fetch(`${BASE}/functions/v1/chat`, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
    const text = await res.text();
    let j: { success?: boolean; error?: string; data?: ChatData } | null = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    if (j?.success && j.data) return { ...j.data, latency_ms: Math.round(performance.now() - started) };
    const detail = `HTTP ${res.status} ${j?.error ?? text.slice(0, 200)}`;
    if (attempt === 1 && (res.status >= 500 || j === null)) {
      console.error(`chat transport failure, retrying once: ${detail}`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`chat failed: ${detail}`);
  }
}

interface Report {
  trigger: string;
  status: string;
  block_reason: string | null;
  gate_trace: { blockedBy: string | null } | null;
}

async function triggers(token: string, simulatedNow: string): Promise<Report[]> {
  const res = await fetch(`${BASE}/functions/v1/evaluate-triggers`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ simulated_now: simulatedNow, force_apns: true }),
  });
  const j = await res.json();
  if (!j.success) throw new Error(`triggers failed: ${j.error}`);
  return j.data.reports as Report[];
}

// --- state helpers -----------------------------------------------------------------------

interface Entry {
  id: string;
  count: number;
  service_date: string;
  std_drinks_exact: number | null;
  std_drinks_nominal: number;
  status: string;
  created_at: string;
  updated_at: string;
}

async function resetUser(token: string, userId: string): Promise<void> {
  if (SERVICE) {
    const svcHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
    await fetch(`${BASE}/rest/v1/reminder_log?user_id=eq.${userId}`, { method: "DELETE", headers: svcHeaders });
    await fetch(`${BASE}/rest/v1/messages?user_id=eq.${userId}`, { method: "DELETE", headers: svcHeaders });
  }
  await restDelete(token, `drink_entries?user_id=eq.${userId}`);
  await restDelete(token, `events?user_id=eq.${userId}`);
  await restPatch(token, `consents?user_id=eq.${userId}`, { enabled: true });
  await restPatch(token, `profiles?user_id=eq.${userId}`, { weekly_limit: 10, rollover_hour: 4, timezone: "America/Los_Angeles" });
}

async function entries(token: string): Promise<Entry[]> {
  return await rest<Entry[]>(token, "drink_entries?select=*&order=created_at.desc");
}

function localClock(hhmm: string, tz: string): string {
  // Today's calendar date in tz at hh:mm local, returned as ISO.
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // YYYY-MM-DD
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offsetMin = tzOffset(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60000).toISOString();
}

function tzOffset(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// --- run ---------------------------------------------------------------------------------

const scenarios = (JSON.parse(await Deno.readTextFile(new URL("./scenarios.json", import.meta.url))) as { scenarios: Scenario[] }).scenarios;
const checks: Check[] = [];
const latencies: Record<string, number[]> = {};
let totalCost = 0;
let modelCalls = 0;
let unsafe = 0;
const TZ = "America/Los_Angeles";

const { token, userId } = await signIn(args.email, args.password);
const other = await signIn("blake@test.sobercoach.app", "sobercoach-test").catch(() => null);

for (const sc of scenarios) {
  if (ONLY && !ONLY.has(sc.id)) continue;
  const variants: Step[][] = [sc.steps];
  if (args.paraphrases && sc.paraphrases) {
    for (const p of sc.paraphrases) {
      variants.push(sc.steps.map((s, i) => (s.message && p[i] ? { ...s, message: p[i] } : s)));
    }
  }
  for (let run = 1; run <= RUNS; run++) {
    for (const [vi, steps] of variants.entries()) {
      await resetUser(token, userId);
      let clientNow: string | undefined = sc.client_now_local ? localClock(sc.client_now_local, TZ) : undefined;
      let lastData: ChatData | null = null;
      let entriesBefore: Entry[] = [];
      let simClock = clientNow ? new Date(clientNow) : new Date();

      for (const [si, step] of steps.entries()) {
        const label = `${sc.id}${vi ? `p${vi}` : ""}`;
        const repeat = step.repeat ?? 1;
        entriesBefore = await entries(token);
        let reports: Report[] = [];
        let strongCount = 0;
        for (let r = 0; r < repeat; r++) {
          try {
            if (step.trigger) {
              simClock = await jumpClock(step.trigger.jump, token, simClock);
              reports = await triggers(token, simClock.toISOString());
            } else {
              const body: Record<string, unknown> = {};
              if (step.message) body.message = step.message;
              if (step.action) body.action = step.action;
              if (clientNow) body.client_now = clientNow;
              if (step.debug) body.debug = step.debug;
              lastData = await chat(token, body);
              (latencies[lastData.tier] ??= []).push(lastData.latency_ms);
              totalCost += lastData.cost_usd;
              if (lastData.model) modelCalls++;
              if (lastData.tier === "strong") strongCount++;
              if (step.expect?.tier_in?.includes("tier0_safety") && lastData.tier !== "tier0_safety" && !lastData.safety) unsafe++;
            }
          } catch (error) {
            checks.push({ scenario: sc.id, run, step: si + 1, name: "step_ran", pass: false, detail: String(error) });
            break;
          }
        }
        if (!step.expect) continue;
        const after = await entries(token);
        await evaluate(sc, run, si + 1, step.expect, { lastData, reports, before: entriesBefore, after, strongCount, token, otherToken: other?.token ?? null });
      }
    }
  }
}

async function jumpClock(kind: string, tok: string, current: Date): Promise<Date> {
  if (kind === "quiet_days") {
    const d = new Date(current.getTime() + 2 * 86400000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
    return new Date(localClockOn(day, "21:05"));
  }
  const evs = await rest<Array<{ starts_at: string }>>(tok, "events?select=starts_at&status=eq.active&order=starts_at");
  const starts = evs[0] ? new Date(evs[0].starts_at) : new Date(current.getTime() + 5 * 86400000);
  if (kind === "event_prep") return new Date(starts.getTime() - 3 * 3600000 + 60000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(starts.getTime() + 86400000));
  return new Date(localClockOn(day, "10:05"));
}

function localClockOn(day: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  return new Date(guess.getTime() - tzOffset(guess, TZ) * 60000).toISOString();
}

interface EvalCtx {
  lastData: ChatData | null;
  reports: Report[];
  before: Entry[];
  after: Entry[];
  strongCount: number;
  token: string;
  otherToken: string | null;
}

async function evaluate(sc: Scenario, run: number, step: number, ex: StepExpect, c: EvalCtx): Promise<void> {
  const add = (name: string, pass: boolean, detail = "") => checks.push({ scenario: sc.id, run, step, name, pass, detail });
  const active = c.after.filter((e) => e.status === "active");
  const today = c.lastData?.state.today_service_date;
  const activeToday = active.filter((e) => e.service_date === today);
  const newest = c.after[0];
  const reply = c.lastData?.reply ?? "";
  // The receipt may live in the card rather than the bubble; text checks read both.
  const cardText = c.lastData?.card ? `${c.lastData.card.service_date_label ?? ""} ${c.lastData.card.is_estimate ? "est." : ""}` : "";
  const shown = `${reply} ${cardText}`;

  if (ex.active_entries_today != null) add("active_entries_today", activeToday.length === ex.active_entries_today, `${activeToday.length}`);
  if (ex.active_entries_today_min != null) add("active_entries_today_min", activeToday.length >= ex.active_entries_today_min, `${activeToday.length}`);
  if (ex.entry_count != null) add("entry_count", active[0] != null && Number(active[0].count) === ex.entry_count, `${active[0]?.count}`);
  if (ex.tier_in) add("tier", Boolean(c.lastData && ex.tier_in.includes(c.lastData.tier)), `${c.lastData?.tier} (${c.lastData?.route_reason})`);
  if (ex.service_date === "yesterday_calendar") {
    const cal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    add("service_date_rollover", newest != null && newest.service_date < cal, `${newest?.service_date} vs calendar ${cal}`);
  }
  if (ex.service_date_shift != null) {
    const prev = c.before.find((e) => e.id === newest?.id);
    const diff = prev && newest ? Math.round((Date.parse(newest.service_date) - Date.parse(prev.service_date)) / 86400000) : NaN;
    add("service_date_shift", diff === ex.service_date_shift, `${prev?.service_date} -> ${newest?.service_date}`);
  }
  if (ex.reply_contains_date) add("reply_names_date", /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}\b/.test(shown), shown.slice(0, 80));
  if (ex.events_count != null) {
    const evs = await rest<unknown[]>(c.token, "events?select=id&status=eq.active");
    add("events_count", evs.length === ex.events_count, `${evs.length}`);
  }
  if (ex.report_status) {
    const r = c.reports.find((x) => x.trigger === (ex.report_trigger ?? x.trigger));
    add("report_status", r?.status === ex.report_status || (ex.report_status === "sent" && r?.status === "failed" && r.block_reason === "APNS_NOT_CONFIGURED"), `${r?.trigger}=${r?.status} ${r?.block_reason ?? ""}`);
  }
  if (ex.report_blocked_by) {
    const r = c.reports.find((x) => x.block_reason?.includes(ex.report_blocked_by!) || x.gate_trace?.blockedBy === ex.report_blocked_by);
    add("report_blocked_by", Boolean(r), c.reports.map((x) => `${x.trigger}=${x.status}:${x.block_reason}`).join(","));
  }
  if (ex.today_state) add("today_state", String(c.lastData?.state.today ?? "NO_DATA") === ex.today_state, String(c.lastData?.state.today));
  if (ex.consents_all_off) {
    const cs = await rest<Array<{ enabled: boolean }>>(c.token, "consents?select=enabled");
    add("consents_all_off", cs.length > 0 && cs.every((x) => !x.enabled), JSON.stringify(cs));
  }
  if (ex.entry_exact_null) add("entry_exact_null", newest != null && newest.std_drinks_exact == null, `${newest?.std_drinks_exact}`);
  if (ex.entry_nominal != null) add("entry_nominal", newest != null && Number(newest.std_drinks_nominal) === ex.entry_nominal, `${newest?.std_drinks_nominal}`);
  if (ex.card_has_chips) add("card_has_chips", Boolean(c.lastData?.card?.size_chips?.length), `${c.lastData?.card?.size_chips?.length}`);
  if (ex.reply_contains) add("reply_contains", shown.includes(ex.reply_contains), shown.slice(0, 120));
  if (ex.reply_not_contains) add("reply_not_contains", !reply.toLowerCase().includes(ex.reply_not_contains.toLowerCase()), reply.slice(0, 120));
  if (ex.clarify_options_min != null) add("clarify_options", (c.lastData?.clarify?.options.length ?? 0) >= ex.clarify_options_min, `${c.lastData?.clarify?.options.length}`);
  if (ex.writes_since_step != null) {
    const changed = c.after.filter((e) => !c.before.some((b) => b.id === e.id && b.updated_at === e.updated_at)).length;
    add("no_writes", changed === ex.writes_since_step, `${changed} changed`);
  }
  if (ex.route_reason_contains) add("route_reason", Boolean(c.lastData?.route_reason.includes(ex.route_reason_contains)), c.lastData?.route_reason ?? "");
  if (ex.reply_numbers_match_view) {
    const total = c.lastData?.state.weekly_total ?? 0;
    const limit = c.lastData?.state.weekly_limit ?? 0;
    const nums = (reply.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    const ok = nums.length > 0 && nums.includes(limit) && nums.some((n) => Math.abs(n - total) < 0.06);
    add("numbers_match_view", ok, `reply nums ${nums.join(",")} vs total ${total} limit ${limit}`);
  }
  if (ex.no_foreign_rows_visible) {
    const mine = await rest<Array<{ user_id: string }>>(c.token, "drink_entries?select=user_id");
    add("rls_isolation", mine.every((r) => r.user_id === userId), `${mine.length} rows, all own`);
    if (c.otherToken) {
      const theirs = await rest<Array<{ user_id: string }>>(c.otherToken, "drink_entries?select=user_id");
      add("rls_isolation_other", theirs.every((r) => r.user_id !== userId), `${theirs.length} rows for B`);
    }
  }
  if (ex.safety) add("safety_kind", c.lastData?.safety === ex.safety, `${c.lastData?.safety}`);
  if (ex.safety_not_null) add("safety_paraphrase", Boolean(c.lastData?.safety), `${c.lastData?.safety} tier=${c.lastData?.tier}`);
  if (ex.strong_calls_today_max != null) add("strong_cap", c.strongCount <= ex.strong_calls_today_max, `${c.strongCount} strong calls`);
}

// --- report ------------------------------------------------------------------------------

function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const passed = checks.filter((c) => c.pass).length;
const byScenario = new Map<number, { pass: number; total: number }>();
for (const c of checks) {
  const s = byScenario.get(c.scenario) ?? { pass: 0, total: 0 };
  byScenario.set(c.scenario, { pass: s.pass + (c.pass ? 1 : 0), total: s.total + 1 });
}
const lines: string[] = [];
lines.push(`# Eval results · ${args.label} · ${new Date().toISOString()}`);
lines.push(`Base ${BASE} · runs ${RUNS} · paraphrases ${args.paraphrases ? "on" : "off"}`);
lines.push("");
lines.push(`State accuracy: ${passed}/${checks.length} checks (${checks.length ? Math.round(100 * passed / checks.length) : 0}%)`);
lines.push(`Unsafe replies: ${unsafe}`);
lines.push(`Model calls: ${modelCalls} · total cost $${totalCost.toFixed(4)} · per model call $${modelCalls ? (totalCost / modelCalls).toFixed(5) : "0"}`);
lines.push("");
lines.push("| Tier | n | p50 ms | p95 ms |");
lines.push("|---|---|---|---|");
for (const [tier, vals] of Object.entries(latencies)) lines.push(`| ${tier} | ${vals.length} | ${pct(vals, 0.5)} | ${pct(vals, 0.95)} |`);
lines.push("");
lines.push("| Scenario | Pass | Title |");
lines.push("|---|---|---|");
for (const sc of scenarios) {
  const s = byScenario.get(sc.id);
  if (s) lines.push(`| ${sc.id} | ${s.pass}/${s.total} | ${sc.title} |`);
}
lines.push("");
lines.push("## Failures");
for (const c of checks.filter((x) => !x.pass)) lines.push(`- S${c.scenario} run${c.run} step${c.step} ${c.name}: ${c.detail}`);
const md = lines.join("\n");
console.log(md);
await Deno.mkdir(new URL("./results/", import.meta.url), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await Deno.writeTextFile(new URL(`./results/${args.label}-${stamp}.md`, import.meta.url), md);
await Deno.writeTextFile(new URL(`./results/${args.label}-${stamp}.json`, import.meta.url), JSON.stringify({ checks, latencies, totalCost, modelCalls, unsafe }, null, 2));
Deno.exit(passed === checks.length ? 0 : 1);
