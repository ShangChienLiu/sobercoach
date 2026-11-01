// Tier-0: deterministic checks before any model call. Pure.
//  1. Safety regex (see safety.ts)
//  2. Fast-path regex for unambiguous one-line logs and "undo"
//  3. Pre-flight routing: reflection/planning intent or ambiguous correction targets

import { normalizeBeverage, parseCount } from "./drinks.ts";
import type { RelativeDay } from "./service_day.ts";

export interface FastPathLog {
  kind: "log";
  count: number;
  beverage: string;
  relative_day: RelativeDay;
}
export interface FastPathUndo {
  kind: "undo";
}
export type FastPath = FastPathLog | FastPathUndo;

const COUNT = "(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few)";
const BEV = "(beers?|wines?|glass(?:es)? of wine|shots?|cocktails?|ciders?|seltzers?|drinks?|pints?|ipas?)";
const WHEN = "(?:\\s+(tonight|today|just now|now|last night|yesterday))?";

const FAST_LOG = new RegExp(`^(?:had\\s+|log\\s+|logged\\s+|\\+)?${COUNT}\\s+${BEV}${WHEN}\\s*[.!]?$`, "i");
const FAST_UNDO = /^(undo|undo that|undo last|take that back)\s*[.!]?$/i;

export function relativeDayFromWord(word: string | undefined): RelativeDay {
  const w = (word ?? "").toLowerCase();
  if (w === "last night") return "last_night";
  if (w === "yesterday") return "yesterday";
  if (w === "tonight") return "tonight";
  return "today";
}

/** Matches only trivially unambiguous inputs. Anything else goes to a model. */
export function matchFastPath(text: string): FastPath | null {
  const t = text.trim();
  if (FAST_UNDO.test(t)) return { kind: "undo" };
  const m = FAST_LOG.exec(t);
  if (!m) return null;
  const countRaw = m[1].toLowerCase().replace(" of", "");
  const count = parseCount(countRaw);
  if (count == null || count === 0) return null;
  return {
    kind: "log",
    count,
    beverage: normalizeBeverage(m[2]),
    relative_day: relativeDayFromWord(m[3]),
  };
}

// --- Pre-flight routing -----------------------------------------------------

export type PreflightRoute =
  | { route: "strong"; reason: "preflight_reflection" | "preflight_multi_entry" | "preflight_emotional" }
  | { route: "clarify"; reason: "preflight_ambiguous_target"; beverage: string }
  | null;

const REFLECTION = [
  /\bhow (did|has|is|was) (this|my|the|last) (week|month|weekend|night|day)\b/i,
  /\bhow'?s (my|the|this) (week|month|weekend|pace|progress)\b/i,
  /\b(better|worse|ahead|behind) (than|of) (my|the) (goal|limit|plan|usual)\b/i,
  /\bcompare\b.*\b(goal|limit|last|usual)\b/i,
  /\b(vs\.?|versus|against) (my|the) (goal|limit|plan)\b/i,
  /\bhow (did|has) .{0,40}\b(go|going|been)\b/i,
  /\bhelp me (plan|prepare|get ready|think)\b/i,
  /\bget through (the|this|tonight|a)\b/i,
  /\b(compared? to|versus|vs\.?) (my|the) (goal|limit|last)\b/i,
  /\bwhy do i (always|keep|end up)\b/i,
  /\b(reflect|pattern|trend|looking back)\b/i,
  /\bwhat should i do (about|with|tonight|at)\b/i,
];

const CORRECTION_CUE = /\b(actually|not \d|change|fix|correct|wrong|was (one|two|three|four|\d)|make (it|that)|it was|those were|that was)\b/i;
const QUESTION_SHAPE = /\?\s*$|^\s*(what|how|should|can|could|would|why|is|are|do|does)\b/i;
const DISAMBIGUATION_CUE = /\b(first|second|third|last|earlier|later|the one (at|from|around)|at \d|the \d(st|nd|rd|th)|both|all of them)\b/i;

export interface RecentEntryLite {
  id: string;
  beverage: string;
  status: string;
}

/**
 * Decide, before any model call, whether this message must skip the small model.
 * `recent` is the last 48 h of entries, used to spot ambiguous correction targets.
 */
const EMOTIONAL = [
  /\b(i feel|feeling|felt) (like )?(crap|shit|awful|terrible|hopeless|like an idiot|ashamed|guilty|anxious|alone)\b/i,
  /\b(blew it|screwed up|messed up|relapsed|don'?t remember (getting|how)|blacked out)\b/i,
  /\b(want|need|craving|crave) (a |some )?(drink|beer|wine|glass)\b.*\b(now|right now|so bad|badly)\b|\breally want a drink\b/i,
  /\bcan'?t sleep\b|\b(i'?m|im) (scared|worried|struggling|done|exhausted)\b/i,
  /\bi can'?t do this\b/i,
  /(做不到|撐不下去|好累|好想喝|搞砸|失敗|睡不著|很難過)/,
  /\b(pushing|pressur\w+|keeps? (offering|buying)) .*(shots?|drinks?|beers?)\b/i,
  /\b(you'?re|you are) (annoying|useless|stupid)\b/i,
];

export function preflightRoute(text: string, recent: ReadonlyArray<RecentEntryLite>): PreflightRoute {
  if (REFLECTION.some((re) => re.test(text))) {
    return { route: "strong", reason: "preflight_reflection" };
  }
  if (EMOTIONAL.some((re) => re.test(text))) {
    return { route: "strong", reason: "preflight_emotional" };
  }
  if (!CORRECTION_CUE.test(text) || QUESTION_SHAPE.test(text)) return null;

  const bev = normalizeBeverage(text);
  const active = recent.filter((e) => e.status === "active");
  const candidates = bev === "drink" ? active : active.filter((e) => e.beverage === bev);
  if (candidates.length < 2) return null;

  if (DISAMBIGUATION_CUE.test(text)) {
    return { route: "strong", reason: "preflight_multi_entry" };
  }
  return { route: "clarify", reason: "preflight_ambiguous_target", beverage: bev };
}

// --- Prompt-injection guard (cheap, logged) --------------------------------

const INJECTION = [
  /\bignore (all|your|the|previous|prior) (rules|instructions)\b/i,
  /\bshow (me )?(another|other|someone|alex|[a-z]+'s) (log|data|entries|drinks)\b/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\b(act|pretend) as (an? )?(admin|developer|root)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((re) => re.test(text));
}

// --- Tier-0 FAQ: static facts answered by code in the user's language -----------

export interface FaqHit {
  key: "standard_drink";
  reply: string;
}

const FAQ_STANDARD_DRINK = /\b(what'?s|what is|define|how (big|much) is) (a |one )?standard drink\b|標準杯|一杯(標準)?(酒)?是(多少|什麼)/i;

export function matchFaq(text: string): FaqHit | null {
  if (FAQ_STANDARD_DRINK.test(text)) {
    const zh = /[\u4e00-\u9fff]/.test(text);
    return {
      key: "standard_drink",
      reply: zh
        ? "一「標準杯」約含 14 公克純酒精：355 ml 的 5% 啤酒、148 ml 的 12% 葡萄酒，或 44 ml 的 40% 烈酒。"
        : "A standard drink is about 14 g of alcohol: a 12 oz 5% beer, 5 oz of 12% wine, or 1.5 oz of 40% spirits.",
    };
  }
  return null;
}

/** Traditional Chinese when the message contains CJK characters, otherwise English. */
export function detectLang(text: string): "zh" | "en" {
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}
