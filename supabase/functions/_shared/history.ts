// search_history: the AGENTS layer asks for 1 to 3 of the user's own words; code searches
// the user's chat ledger (RLS-scoped RPC), renders dated snippets with that day's verified
// total, and the writer only adds what stands out. The model never invents a memory.

import type { Db } from "./db.ts";
import type { TurnContext } from "./context.ts";
import { toNumber } from "./db.ts";

export interface HistoryHit {
  created_at: string;
  role: string;
  content: string;
  matched: number;
  service_date: string;
  std_drinks: number | null;
}

const MAX_TERMS = 3;
/** English filler the model sometimes passes through; the user's content words are what match. */
const STOPWORDS = new Set(["what","about","the","did","i","say","said","my","me","do","does","how","was","were","that","this","at","in","on","to","of","and","a","an","for","with","last","time","when","you","tell","told","went","go","it","is","are","we","had","have","there","then"]);
const MIN_TERM_CHARS = 2;
const SNIPPET_CHARS = 140;
const HISTORY_LIMIT = 5;

/** The user's words as search terms: lower-cased, whitespace-split, two chars or more, unique, at most three. */
export function historyTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const t = raw.trim();
    if (t.length < MIN_TERM_CHARS || STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

function fmtDay(iso: string, tz: string, lang: "zh" | "en"): string {
  const d = new Date(iso);
  if (lang === "zh") {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric", day: "numeric" }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("month")}/${get("day")}`;
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
}

function snippet(content: string): string {
  const one = content.replace(/\s+/g, " ").trim();
  return one.length > SNIPPET_CHARS ? `${one.slice(0, SNIPPET_CHARS)}…` : one;
}

/** Code-rendered fact line: every figure in it is verified, so the guard allows it. */
export function renderHistoryLine(terms: string[], hits: ReadonlyArray<HistoryHit>, lang: "zh" | "en", tz: string): string {
  const q = terms.join(" ");
  if (!hits.length) return lang === "zh" ? `之前的對話裡沒有提到「${q}」。` : `Nothing earlier about "${q}" in our chats.`;
  const items = hits.map((h) => {
    const who = lang === "zh" ? (h.role === "user" ? "你" : "教練") : (h.role === "user" ? "you" : "coach");
    const total = h.std_drinks != null
      ? (lang === "zh" ? ` [那天記了 ${h.std_drinks.toFixed(1)} 杯]` : ` [logged ${h.std_drinks.toFixed(1)} that day]`)
      : "";
    return lang === "zh"
      ? `${fmtDay(h.created_at, tz, lang)}（${who}）「${snippet(h.content)}」${total}`
      : `${fmtDay(h.created_at, tz, lang)} (${who}): "${snippet(h.content)}"${total}`;
  });
  return lang === "zh" ? `之前提到「${q}」：${items.join("；")}` : `Earlier about "${q}": ${items.join("; ")}`;
}

export interface HistorySearchResult {
  terms: string[];
  hits: HistoryHit[];
  line: string;
}

/** Searches the caller's own ledger through the RLS-scoped RPC. Errors propagate so the tool reports a failure, never a fake memory. */
export async function searchHistory(db: Db, ctx: TurnContext, text: string): Promise<HistorySearchResult> {
  const terms = historyTerms(text);
  if (!terms.length) return { terms, hits: [], line: renderHistoryLine([text.trim() || "?"], [], ctx.lang, ctx.profile.timezone) };
  const { data, error } = await db.rpc("search_messages", {
    p_user_id: ctx.userId,
    p_terms: terms,
    p_exclude: ctx.userMessage ?? null,
    p_tz: ctx.profile.timezone,
    p_rollover: ctx.profile.rollover_hour,
    p_limit: HISTORY_LIMIT,
  });
  if (error) throw new Error(`search_messages failed: ${error.message}`);
  const hits: HistoryHit[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    created_at: String(r.created_at),
    role: String(r.role),
    content: String(r.content),
    matched: toNumber(r.matched, 0),
    service_date: String(r.service_date),
    std_drinks: r.std_drinks == null ? null : toNumber(r.std_drinks, 0),
  }));
  return { terms, hits, line: renderHistoryLine(terms, hits, ctx.lang, ctx.profile.timezone) };
}
