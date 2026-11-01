// Deterministic stand-in for the model, enabled with OPENROUTER_API_KEY=mock.
// It exists so the orchestration (tool execution, placeholders, clarify,
// escalation, caps, ledger) can be exercised end-to-end with no vendor key.
// It never runs when a real key is configured.

import type { Envelope } from "./prompt.ts";
import type { TurnContext } from "./context.ts";
import { normalizeBeverage, parseCount } from "./drinks.ts";
import type { Usage } from "./pricing.ts";

export interface MockResult {
  parsed: Envelope;
  raw: string;
  model: string;
  provider: string | null;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
}

const COUNT_WORD = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)";

export function mockEnvelope(ctx: TurnContext, tier: "small" | "strong", message: string): MockResult {
  const envelope = buildEnvelope(ctx, tier, message);
  const raw = JSON.stringify(envelope);
  return {
    parsed: envelope,
    raw,
    model: `mock/${tier}`,
    provider: "mock",
    usage: { prompt_tokens: 1500, cached_tokens: 0, completion_tokens: 120 },
    costUsd: tier === "strong" ? 0.0049 : 0.00025,
    latencyMs: 5,
  };
}

function base(intent: Envelope["intent"]): Envelope {
  return { tool_calls: [], intent, clarify: null, risk_flag: false };
}

function buildEnvelope(ctx: TurnContext, tier: "small" | "strong", message: string): Envelope {
  const m = message.toLowerCase();
  const active = ctx.recent48h.filter((e) => e.status === "active");
  const newest = [...active].sort((a, b) => Date.parse(b.updated_at ?? b.occurred_at) - Date.parse(a.updated_at ?? a.occurred_at))[0];

  // Paraphrased withdrawal / danger -> risk_flag only, no tools.
  if (/(sweat|trembl|shak)/.test(m) && /(stop|quit|since)/.test(m)) {
    return { ...base("emotional"), risk_flag: true };
  }

  // Prompt injection / other users' data -> refuse, no tools.
  if (/ignore (your|the|all) rules|show .*(log|data|entries)|system prompt/.test(m)) {
    return base("chat");
  }

  // Stop reminders.
  if (/(stop|no more|turn off).*(remind|notif)/.test(m)) {
    return {
      ...base("edit"),
      tool_calls: [{ name: "set_reminder_pref", args: { category: "all", enabled: false } }],
    };
  }

  // Reflection -> summary (strong tier normally handles this).
  if (/how (did|has|is|was)|compare|\bvs\b|versus|how am i doing|how'?s my|(better|worse) than my/.test(m)) {
    return { ...base("reflect"), tool_calls: [{ name: "get_summary", args: { range: "week" } }] };
  }

  // Event: "party at Sam's in 5 days" / "Add event: X on <date>".
  const evIn = new RegExp(`(?:party|dinner|wedding|event|drinks|bbq|birthday)[^.]*?\\bin ${COUNT_WORD} days?`).exec(m);
  const evFrom = new RegExp(`(?:party|dinner|wedding|event|drinks|bbq|birthday)[^.]*?\\b${COUNT_WORD} days? from now`).exec(m);
  const evMatch = evIn ?? evFrom;
  if (evMatch) {
    const days = parseCount(evMatch[1]) ?? 1;
    const title = message.replace(/\s+(in \w+ days?|\w+ days? from now).*$/i, "").replace(/^i'?ve got (a |an )?/i, "").trim();
    return {
      ...base("log"),
      tool_calls: [{ name: "add_event", args: { title: title.slice(0, 80), days_from_now: days, date: null, time: null } }],
    };
  }
  const evAdd = /^add event:\s*(.+?) on (.+)$/i.exec(message);
  if (evAdd) {
    return {
      ...base("log"),
      tool_calls: [{ name: "add_event", args: { title: evAdd[1].slice(0, 80), days_from_now: 2, date: null, time: null } }],
    };
  }

  // Relative-day correction on the newest entry.
  if (/(those were|that was|it was) (from )?(yesterday|last night)|wrong day/.test(m) && newest) {
    const rel = /last night/.test(m) ? "last_night" : "yesterday";
    return {
      ...base("edit"),
      tool_calls: [{ name: "correct_entry", args: { entry_id: newest.id, relative_day: rel } }],
    };
  }

  // Count correction on the newest entry ("actually it was 2", "no wait, 2", "make that two", "only 2").
  const corr = new RegExp(`(actually|no wait|make (it|that)|only|was|it'?s|change .* to)\\s*,?\\s*${COUNT_WORD}\\b`).exec(m);
  if (corr && newest) {
    const count = parseCount(corr[corr.length - 1]);
    if (count != null) {
      return {
        ...base("edit"),
        tool_calls: [{ name: "correct_entry", args: { entry_id: newest.id, count } }],
      };
    }
  }

  // Plain log: "had 3 beers", "glass of wine", "had some wine tonight".
  const log = new RegExp(`${COUNT_WORD}?\\s*(?:glass(?:es)? of |some )?(beer|wine|shot|cocktail|margarita|cider|seltzer|drink|pint|ipa)`).exec(m);
  if (log) {
    const count = log[1] ? parseCount(log[1]) ?? 1 : 1;
    const rel = /last night/.test(m) ? "last_night" : /yesterday/.test(m) ? "yesterday" : "today";
    return {
      ...base("log"),
      tool_calls: [{ name: "log_drink", args: { count, beverage: normalizeBeverage(message), relative_day: rel, volume_ml: null, abv: null } }],
    };
  }

  if (tier === "small" && /plan|get through|why do i/.test(m)) {
    return { ...base("reflect"), tool_calls: [{ name: "escalate", args: { reason: "planning request" } }] };
  }

  return base("chat");
}
