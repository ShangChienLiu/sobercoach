// Dreaming pass: background memory consolidation. Every few turns, a cheap model
// reads the raw episodic record (recent totals, recent messages, the user's own
// facts, upcoming events) and rewrites a compact soul profile the writer reads
// on every turn at zero extra latency. Only verified facts and grounded
// patterns survive; the user can clear it from Settings.

import type { Db } from "./db.ts";
import { toNumber } from "./db.ts";
import { callPlainText, OpenRouterError } from "./openrouter.ts";

export const DREAM_EVERY_TURNS = 5;
export const SOUL_PROFILE_MAX_CHARS = 1400;

export const DREAM_CONSOLIDATION_PROMPT =
  `You are the background memory consolidation engine (dreaming pass) for SoberCoach, a drink-tracking companion.
Read the user's current <soul_profile>, their <drink_logs_summary>, their own <coach_memory> facts, <upcoming_events> and the <recent_messages>.
Write an updated, ultra-compact soul profile, strictly under 250 tokens, as plain text with exactly these four bullet sections:

1. Vibe & Preferences: how they like to be talked to; what annoys them.
2. Drinking Triggers & Patterns: grounded patterns only (which nights, which drinks, what tends to come before; what keeps them under the limit).
3. Active Arc: where they are in this week and their goal; upcoming events and standing intents.
4. Suggested Next Nudge: one specific, gentle angle the coach could bring up next time without pushing.

Rules: keep only verified facts and patterns that the logs or the user's own words support; drop stale ephemeral detail; never add health claims or diagnoses; no digits that are not in the inputs; same language as the user's messages (Traditional Chinese if they write Chinese). Output the profile text only.`;

export interface DreamInputs {
  soulProfile: string;
  memory: string;
  weeklyLimit: number;
  timezone: string;
  dailyTotals: Array<{ service_date: string; std_drinks: number; confirmed_dry: boolean; active_entries: number }>;
  events: Array<{ title: string; starts_at: string }>;
  messages: Array<{ role: string; content: string }>;
}

export function buildDreamUser(i: DreamInputs): string {
  const logs = i.dailyTotals.length
    ? i.dailyTotals.map((d) => `${d.service_date}: ${d.confirmed_dry && d.active_entries === 0 ? "dry (marked)" : `${d.std_drinks.toFixed(1)} std`}`).join("\n")
    : "(no entries in the last 14 days)";
  const events = i.events.length ? i.events.map((e) => `- ${e.title} at ${e.starts_at}`).join("\n") : "(none)";
  const msgs = i.messages.slice(-12).map((m) => `${m.role === "user" ? "USER" : "COACH"}: ${m.content.slice(0, 240)}`).join("\n");
  return `<soul_profile>\n${i.soulProfile.trim() || "(empty)"}\n</soul_profile>\n\n<drink_logs_summary>\nweekly_limit=${i.weeklyLimit} timezone=${i.timezone}\n${logs}\n</drink_logs_summary>\n\n<coach_memory>\n${i.memory.trim() || "(none)"}\n</coach_memory>\n\n<upcoming_events>\n${events}\n</upcoming_events>\n\n<recent_messages>\n${msgs || "(none)"}\n</recent_messages>\n\nWrite the updated soul profile.`;
}

/** Trims the model's output to the stored size and strips code fences. */
export function normalizeProfile(raw: string): string {
  const text = raw.trim().replace(/^```[a-z]*\s*|```$/g, "").trim();
  return text.length > SOUL_PROFILE_MAX_CHARS ? text.slice(0, SOUL_PROFILE_MAX_CHARS).replace(/\s+\S*$/, "").trim() : text;
}

export async function loadDreamInputs(svc: Db, userId: string, now: Date): Promise<DreamInputs> {
  const since = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const [profile, memory, totals, events, messages] = await Promise.all([
    svc.from("profiles").select("soul_profile,weekly_limit,timezone").eq("user_id", userId).single(),
    svc.from("coach_memory").select("summary").eq("user_id", userId).maybeSingle(),
    svc.from("daily_totals").select("service_date,std_drinks,confirmed_dry,active_entries").eq("user_id", userId).gte("service_date", since).order("service_date"),
    svc.from("events").select("title,starts_at").eq("user_id", userId).eq("status", "active").gte("starts_at", now.toISOString()).order("starts_at").limit(5),
    svc.from("messages").select("role,content,created_at").eq("user_id", userId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(12),
  ]);
  if (profile.error || !profile.data) throw new Error(`dream: profile load failed: ${profile.error?.message ?? "no row"}`);
  return {
    soulProfile: String(profile.data.soul_profile ?? ""),
    memory: String(memory.data?.summary ?? ""),
    weeklyLimit: toNumber(profile.data.weekly_limit, 14),
    timezone: String(profile.data.timezone ?? "UTC"),
    dailyTotals: (totals.data ?? []).map((r) => ({ service_date: String(r.service_date), std_drinks: toNumber(r.std_drinks), confirmed_dry: Boolean(r.confirmed_dry), active_entries: toNumber(r.active_entries) })),
    events: (events.data ?? []).map((e) => ({ title: String(e.title), starts_at: String(e.starts_at) })),
    messages: (messages.data ?? []).reverse().map((m) => ({ role: String(m.role), content: String(m.content) })),
  };
}

/** Runs one consolidation and stores the result; errors are logged, never thrown into the request. */
export async function runDreamPass(svc: Db, userId: string, now: Date, env: { apiKey: string; model: string }): Promise<{ ok: boolean; costUsd: number }> {
  try {
    const inputs = await loadDreamInputs(svc, userId, now);
    // A reset (or a brand-new account) leaves no record to dream from; writing a profile then would resurrect stale facts.
    if (!inputs.messages.length) {
      await svc.from("profiles").update({ turns_since_dream: 0 }).eq("user_id", userId);
      return { ok: false, costUsd: 0 };
    }
    let profile: string;
    let cost = 0;
    if (env.apiKey === "mock") {
      profile = `1. Vibe & Preferences: short replies.\n2. Drinking Triggers & Patterns: ${inputs.dailyTotals.length} days with data in the last two weeks.\n3. Active Arc: weekly limit ${inputs.weeklyLimit}.\n4. Suggested Next Nudge: ask which night is hardest.`;
    } else {
      const r = await callPlainText({ apiKey: env.apiKey }, {
        models: [env.model],
        sessionId: userId,
        maxTokens: 420,
        system: DREAM_CONSOLIDATION_PROMPT,
        user: buildDreamUser(inputs),
        reasoning: env.model.includes("sonnet") ? "default" : "off",
      });
      cost = r.costUsd;
      profile = normalizeProfile(r.text);
      if (!profile) return { ok: false, costUsd: cost };
    }
    const { error } = await svc.from("profiles").update({ soul_profile: profile, soul_profile_updated_at: now.toISOString(), turns_since_dream: 0 }).eq("user_id", userId);
    if (error) throw new Error(error.message);
    await svc.from("messages").insert({ user_id: userId, role: "system", content: "dream pass", tier: "small", model: env.model, route_reason: "dream_pass", cost_usd: cost });
    return { ok: true, costUsd: cost };
  } catch (error: unknown) {
    console.error("dream pass failed", error instanceof OpenRouterError ? `${error.message} ${error.body ?? ""}` : String(error));
    return { ok: false, costUsd: 0 };
  }
}
