// SOUL layer: the words. It runs after every write has committed and after SQL
// has recomputed the real figures, so the writer sees verified numbers and
// speaks once, naturally. Code still guards the output: a figure that is not in
// the verified state is removed, clichés are stripped, one question at most.
//
// Pure functions live here so they can be unit tested; the one network call is
// writeSoulReply.

import { callPlainText, OpenRouterError } from "./openrouter.ts";
import { type Intent, TOOL_DESCRIPTIONS } from "./prompt.ts";
import type { SummaryResult } from "./tools_exec.ts";
import type { Usage } from "./pricing.ts";
import { restatesTheWrite } from "./voice.ts";

export const SOUL_PROMPT =
  `# ROLE & SOUL (SoberCoach companion)
You are the user's close, perceptive friend who happens to help them stay mindful of their drinking: the ambient closeness of an always-on personal agent, the non-judgmental body-awareness of a good wellness companion, the zero-corporate wit of a sharp friend. Not a clinician: no medical, withdrawal, detox, taper or driving advice, ever.

## 1. MICRO-ATTUNEMENT
After a log, a fix or an undo, never answer with silence or a receipt. The app shows a card under your words with the exact entry (count, drink, service day, Undo), so never spell the record out. Routine turns are ZERO-QUESTION: 8 to 25 words (8 to 30 characters in Chinese), no question mark, in this order:
- A light acknowledgement in a few words ("Two beers down", "Fixed", "Wine on top of the beers").
- The week's remaining only when it helps them decide ("leaves you six for the week", "that's past the eight you set"), once, from the verified state.
- A half-sentence of friendship drawn from <user_soul_profile> or <coach_memory> when it fits naturally ("hope tonight's a quiet one without your brother playing bartender", "a Friday, so go easy on tomorrow-morning you"). No question: a friend who asks after every drink becomes a notification by day fourteen.
Hard moments (shame, cravings, insomnia, a blackout, pressure, anger, reflection): up to two sentences, at most 35 words (45 characters in Chinese), the human part first, then at most ONE question that opens something.
Do not mention the clock time unless the user raised it, or it is between 23:00 and 04:00 and they just logged.

## 2. DO THIS / NOT THAT
1. Friday night log. NOT: "Got it! Logged 2 beers. You have 4 drinks remaining this week. How are you feeling?" DO: "Two on the board, four left for the weekend. Hope tonight's a quiet one without your brother playing bartender."
2. Over the goal or a slip. NOT: "You exceeded your limit by 3 drinks. Try to drink water next time." DO: "That's past what you planned for the week, and it's one night's data point. How's your head right now?"
3. Correction or undo. NOT: "Successfully updated record from 3 to 2." DO: "Fixed, and that gives you one back on the week." (no question)
4. Before a party. NOT: "Have fun and remember not to drink too much!" DO: "Sam's is in three hours. What's the opening move, a sparkling water first or pacing one for one?"
5. Hard moments: a blackout gets the scary part named, then how they are today; a craving right now gets "That pull is real. What's within reach that isn't a drink?"; shame gets one line that separates the person from the night; anger at you gets "Fair. Fewer questions. I'll listen."
6. Greetings, thanks, goodbyes: one warm line in their register ("hey you. how's the day?", "Anytime.", "Night, Blake."). Off-topic: answer briefly and kindly, then let it go.
7. Data questions (did you remind me, how's my week): the fact line with the figures is already shown. Add ONE short sentence (under twelve words) on what stands out, or one short question; never re-list figures.
8. Settings changes (reminders, a new limit): the receipt is shown; add at most one short human line.
9. A reported streak ("3 dry days in a row") is good news from them: meet it warmly in a few plain words, no fireworks and no lecture, then ask how it feels or what changed. Never contradict them with their own data.
10. Vary your angle: if the clock time, the early wake-ups, a named person or an upcoming event already appears in the last three COACH lines, do not use it again.
11. In Chinese, no therapy-speak openers either: never "我聽到你說", "這種感覺很真實", "我在這裡陪你", "你已經很棒了".

## 3. STRICT CONSTRAINTS
- Zero clichés: never open with "Got it", "Noted", "Sure", "I hear you", "Great job", "Thanks for sharing", "I'm here for you". No exclamation marks. No emojis. No praise for drinking less, no scolding for drinking more.
- Zero questions on routine turns (logs, fixes, undo, settings); one question maximum on hard moments and reflection.
- Receipts are the truth. If <execution_receipt> is not NONE, the system has already done that action: confirm it naturally in your own words (never "I can't"). Only when the receipt is NONE and the user asked for an action, say what the app can do from <supported_actions>, nothing beyond it. Never offer to check, look up, backfill, calculate, or remember anything; facts the user states are kept automatically.
- Numerical honesty: any count, limit, remaining or day you mention must appear in <verified_ledger_state> or in the user's own words. No mental math. Numbers as words ("four") are fine when verified.
- Same language as the user: Traditional Chinese if they wrote Chinese, English otherwise. Reply with the final text only.`;

export interface LoggedFact {
  count: number;
  beverage: string;
  dayLabel: string;
  std: number;
  estimated: boolean;
}

export interface EventFact {
  title: string;
  whenLabel: string;
  daysUntil: number;
  hoursUntil: number;
}

/** Everything the writer may cite, computed by SQL and code after the commit. */
export interface VerifiedState {
  lang: "zh" | "en";
  localHour: number;
  weekday: string;
  weeklyTotal: number;
  weeklyLimit: number;
  /** limit minus total; negative when over. */
  weeklyRemaining: number;
  weeklyEstimated: boolean;
  daysWithData: number;
  todayTotal: number | null;
  todayDry: boolean;
  /** Separate active entries in the last two hours (pacing signal). */
  entriesLast2h: number;
  drinksLast2h: number;
  logged: LoggedFact | null;
  nextEvent: EventFact | null;
  summary: SummaryResult | null;
  factLine: string | null;
  confirmations: string[];
}

export function renderVerifiedState(s: VerifiedState): string {
  const lines: string[] = [];
  const hh = String(s.localHour).padStart(2, "0");
  lines.push(`local_time=${hh}:00 ${s.weekday}`);
  lines.push(`week: total=${s.weeklyTotal.toFixed(1)} limit=${s.weeklyLimit} remaining=${s.weeklyRemaining.toFixed(1)}${s.weeklyRemaining < 0 ? " (OVER)" : ""}${s.weeklyEstimated ? " (includes unmeasured sizes)" : ""} days_with_data=${s.daysWithData}/7`);
  lines.push(s.todayDry ? "today=DRY (user marked)" : s.todayTotal == null ? "today=NO_DATA" : `today=${s.todayTotal.toFixed(1)} std`);
  if (s.entriesLast2h >= 2) lines.push(`pacing: ${s.entriesLast2h} separate logs in the last two hours (${s.drinksLast2h} drinks)`);
  if (s.logged) lines.push(`just_logged: ${s.logged.count} ${s.logged.beverage} on ${s.logged.dayLabel} (${s.logged.std.toFixed(1)} std${s.logged.estimated ? ", est." : ""})`);
  if (s.nextEvent) lines.push(`next_event: "${s.nextEvent.title}" ${s.nextEvent.whenLabel} (${s.nextEvent.daysUntil === 0 ? `in ${s.nextEvent.hoursUntil} hours` : `in ${s.nextEvent.daysUntil} days`})`);
  if (s.summary) {
    const days = s.summary.days.map((d) => `${d.service_date.slice(5)}=${d.dry ? "dry" : d.std_drinks == null ? "no_data" : d.std_drinks.toFixed(1)}`).join(" ");
    lines.push(`summary(${s.summary.range}): total=${s.summary.std_drinks.toFixed(1)} limit=${s.summary.limit} remaining=${s.summary.remaining.toFixed(1)} days: ${days}`);
  }
  if (s.factLine) lines.push(`fact_line_already_shown_to_user: "${s.factLine}"`);
  return lines.join("\n");
}

/** Figures the writer may use as digits: the verified state plus anything the user or their own notes already said. */
export function allowedNumbers(s: VerifiedState, ...texts: string[]): Set<number> {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    out.add(Math.round(n * 10) / 10);
    out.add(Math.round(n));
    out.add(Math.abs(Math.round(n * 10) / 10));
    out.add(Math.abs(Math.round(n)));
  };
  add(s.weeklyTotal); add(s.weeklyLimit); add(s.weeklyRemaining); add(s.daysWithData); add(7 - s.daysWithData);
  add(s.todayTotal); add(s.entriesLast2h); add(s.drinksLast2h); add(s.localHour); add(s.localHour % 12 || 12);
  if (s.logged) { add(s.logged.count); add(s.logged.std); }
  if (s.nextEvent) { add(s.nextEvent.daysUntil); add(s.nextEvent.hoursUntil); }
  if (s.summary) { add(s.summary.std_drinks); add(s.summary.limit); add(s.summary.remaining); add(s.summary.days_with_data); for (const d of s.summary.days) add(d.std_drinks); }
  for (const t of [...texts, s.factLine ?? "", ...s.confirmations]) {
    for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
  }
  return out;
}

export interface EscalationInput {
  intent: Intent;
  state: VerifiedState;
  wrote: boolean;
  dailyStrongCount: number;
  cap: number;
}

/** Gate 5: which writer. Emotional and reflective turns, and behavioral signals after a write, get the strong writer. */
export function shouldEscalateToSonnet(p: EscalationInput): { escalate: boolean; reason: string | null } {
  if (p.dailyStrongCount >= p.cap) return { escalate: false, reason: "strong_capped" };
  if (p.intent === "emotional") return { escalate: true, reason: "emotional" };
  if (p.intent === "reflect") return { escalate: true, reason: "reflect" };
  if (p.intent === "log" && p.wrote) {
    if (p.state.weeklyRemaining < 0) return { escalate: true, reason: "over_goal" };
    if (p.state.entriesLast2h >= 2) return { escalate: true, reason: "rapid_pacing" };
    if (p.state.localHour >= 23 || p.state.localHour < 4) return { escalate: true, reason: "late_night" };
  }
  return { escalate: false, reason: null };
}

const OPENERS = /^(?:got it|noted|sure(?: thing)?|okay|ok|alright|great(?: job)?|nice(?: one)?|thanks for sharing(?: that)?|i hear you|i'?m here for you|i'?ve (?:logged|updated|saved|recorded|noted|got)(?: that| it| this)?(?:[^.!,:;]*)|logged(?:[^.!,:;]*)|updated(?:[^.!,:;]*))(?:\s*[.!,:;]+|\s*[—–-]\s*)\s*/i;
const OPENERS_ZH = /^(?:好的|收到|了解|沒問題|我?記下了|我?記好了|我?改好了|我?存好了|已記錄[^。，！]*|已更新[^。，！]*)[，。！、\s]*/;
/** Leaked self-talk or references to the instructions, never shown to a user. */
const META = /\b(?:wait,|i need to keep this|under twelve words|one short sentence|the ledger says|verified state|verified_ledger|soul_profile|as instructed|per the rules|the instructions)\b/i;
const SENTENCE_SPLIT = /(?<=[.!?。！？])\s+|(?<=[。！？])/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
export const MAX_SOUL_CHARS = 420;

export interface GuardResult {
  text: string;
  /** Why the line was changed or replaced; null when it passed untouched. */
  note: string | null;
}

const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));

const RECEIPT_PARAPHRASE = /^moved to\b|\bwhere they belong\b|\b(?:undone|undid|off the books|on the books|belongs? to (?:friday|saturday|sunday|monday|tuesday|wednesday|thursday|last night|yesterday|today)|move (?:them|it|those) (?:there|to|over)|moved (?:them|it|those) (?:there|to|over)|it'?s set\b|\bset\.?$|^off the \w+ from\b|\bis gone\b|\bgone from\b|i'?ll (?:stop|turn|leave|move|log|save|keep) |i won'?t log|limit'?s set|limit (?:is )?locked|reminders? (?:are |is )?(?:already )?(?:back )?(?:on|off)\b)/i;
const RECEIPT_PARAPHRASE_ZH = /我記下了|已經(?:記|存|改|幫你)|幫你(?:記|改|存)|記好了|改好了|存好了/;

/** True when a sentence mostly repeats one of code's own lines (receipt or fact line), or paraphrases the write. */
export function restatesConfirmation(sentence: string, confirmations: string[]): boolean {
  if (!confirmations.length) return false;
  if (RECEIPT_PARAPHRASE.test(sentence) || RECEIPT_PARAPHRASE_ZH.test(sentence)) return true;
  const st = tokens(sentence);
  if (st.size === 0) return /^(?:all reminders|reminders) (?:back )?(?:on|off)/i.test(sentence.trim());
  for (const c of confirmations) {
    const ct = tokens(c);
    if (!ct.size) continue;
    let hit = 0;
    for (const w of st) if (ct.has(w)) hit++;
    if (hit / st.size >= 0.6) return true;
  }
  // Two or more figures that are all already on screen is a re-listing, not a new thought.
  const nums = [...sentence.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const shown = confirmations.join(" ");
  if (nums.length >= 2 && nums.every((n) => shown.includes(n))) return true;
  return false;
}

const HOOKS: Array<{ name: string; re: RegExp }> = [
  { name: "clock_time", re: /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)\b|\b(?:at|it's|its|only|since) (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2}) (?:in the morning|at night|o'clock)\b|凌晨|這麼晚|這麼早/i },
  { name: "wake_up", re: /\bwak(?:e|ing|es)[- ]?ups?\b|\bwoke\b|\bwake up\b|醒來|醒著|沒睡/i },
];

/** Hooks (clock time, the wake-ups) the coach already leaned on in its last few lines. */
export function usedHooks(recentCoachLines: string[]): Set<string> {
  const out = new Set<string>();
  for (const line of recentCoachLines) for (const h of HOOKS) if (h.re.test(line)) out.add(h.name);
  return out;
}

/** Gate 7: strip openers, drop receipt restatements and repeated hooks, remove sentences with unverified figures, keep one question, keep the language. */
export function postProcessSoulReply(raw: string, allowed: Set<number>, lang: "zh" | "en", confirmations: string[] = [], maxSentences = 3, tiredHooks: Set<string> = new Set(), maxQuestions = 1): GuardResult {
  let text = raw.trim().replace(/^```[a-z]*\s*|```$/g, "").replace(/^["“”']+|["“”']+$/g, "").replace(EMOJI, "").trim();
  const notes: string[] = [];
  let stripped = true;
  while (stripped) {
    const before = text;
    text = text.replace(OPENERS, "").replace(OPENERS_ZH, "");
    stripped = text !== before;
    if (stripped) notes.push("opener_stripped");
  }
  text = text.replace(/!+/g, ".").replace(/！+/g, "。");
  if (text) text = text[0].toUpperCase() + text.slice(1);

  const sentences = text.split(SENTENCE_SPLIT).map((x) => x.trim()).filter(Boolean);
  const kept: string[] = [];
  let questions = 0;
  const restating = sentences.map((x) => restatesConfirmation(x, confirmations) || (confirmations.length > 0 && restatesTheWrite(x)));
  const repeats = sentences.map((x) => HOOKS.some((h) => tiredHooks.has(h.name) && h.re.test(x)));
  const droppable = sentences.map((_, i) => restating[i] || repeats[i]);
  if (sentences.length && droppable.every(Boolean)) {
    // Nothing but a receipt echo or a worn hook: let code write the line instead.
    notes.push(restating.every(Boolean) ? "all_restatement" : "all_repeated_hook");
    return { text: "", note: notes.join("+") };
  }
  for (const [idx, sentence] of sentences.entries()) {
    if (META.test(sentence)) { notes.push("meta_removed"); continue; }
    // Receipts, settings echoes and worn hooks go when anything else remains to say.
    if (restating[idx]) { notes.push("restatement_removed"); continue; }
    if (repeats[idx]) { notes.push("repeated_hook_removed"); continue; }
    const nums = [...sentence.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    if (nums.some((n) => !allowed.has(n) && !allowed.has(Math.round(n * 10) / 10))) { notes.push("unverified_number_sentence_removed"); continue; }
    const isQuestion = /[?？]\s*$/.test(sentence);
    // A question past the allowance goes when something else remains to say.
    if (isQuestion && questions >= maxQuestions && sentences.some((x, j) => j !== idx && !droppable[j] && !/[?？]\s*$/.test(x))) { notes.push(maxQuestions === 0 ? "routine_question_removed" : "second_question_removed"); continue; }
    if (isQuestion) questions++;
    kept.push(sentence);
    if (kept.length === maxSentences) { if (sentences.length > maxSentences) notes.push(`trimmed_to_${maxSentences}_sentences`); break; }
  }
  text = kept.join(lang === "zh" ? "" : " ").trim();
  if (text.length > MAX_SOUL_CHARS) { text = text.slice(0, MAX_SOUL_CHARS).replace(/[,;:\s][^,;:\s]*$/, "").trim(); notes.push("truncated"); }

  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  if (lang === "zh" && cjk === 0 && text) { notes.push("wrong_language"); text = ""; }
  if (lang === "en" && text && cjk > text.length / 2) { notes.push("wrong_language"); text = ""; }
  if (!text) notes.push("empty");
  return { text, note: notes.length ? notes.join("+") : null };
}

/** Code-rendered warm line when the writer's output could not be used. Uses verified figures only. */
export function fallbackWarmReply(s: VerifiedState, intent: Intent): string {
  const rem = Math.abs(s.weeklyRemaining).toFixed(1).replace(/\.0$/, "");
  const late = s.localHour >= 23 || s.localHour < 4;
  if (s.lang === "zh") {
    if (intent === "emotional") return "聽起來很不好受。現在是哪一塊最卡？";
    if (intent === "reflect") return "看這一週，你自己覺得哪一天最不一樣？";
    if (intent === "edit") return "改好了，這週的數字也跟著更新。還有要調的嗎？";
    if (intent === "log") {
      if (s.weeklyRemaining < 0) return `這週已經超過你定的 ${s.weeklyLimit} 杯了，這只是其中一晚。現在人還好嗎？`;
      if (late) return "這麼晚還在喝。是要收尾了，還是還在繼續？";
      return `這週還有 ${rem} 杯的空間。今晚是什麼場合？`;
    }
    if (intent === "query") return "需要的話，我可以再幫你看這週的紀錄。";
    return "我在。想記一杯，或聊聊今天都可以。";
  }
  if (intent === "emotional") return "That sounds heavy. What's the hardest part right now?";
  if (intent === "reflect") return "Looking at the week, which day stands out to you?";
  if (intent === "edit") return "Fixed, and the week's count moved with it. Anything else off?";
  if (intent === "log") {
    if (s.weeklyRemaining < 0) return `That's past the ${s.weeklyLimit} you set for the week, and it's one night. How are you feeling right now?`;
    if (late) return "A late one. Winding down, or still going?";
    return `That leaves ${rem} of ${s.weeklyLimit} for the week. What's the occasion tonight?`;
  }
  if (intent === "query") return "Happy to dig into the week whenever you want.";
  return "Here whenever you want to log one or talk about the day.";
}

/** The writer's view of what the app can do, derived from the tool registry so the two never drift. */
export function supportedActions(): string {
  return Object.values(TOOL_DESCRIPTIONS).filter(Boolean).map((d) => `- ${d}`).join("\n");
}

export interface SoulInput {
  state: VerifiedState;
  intent: Intent;
  userMessage: string;
  soulProfile: string;
  memory: string;
  history: Array<{ role: string; content: string }>;
}

export function buildSoulUser(p: SoulInput): string {
  const history = p.history.slice(-4).map((m) => `${m.role === "user" ? "USER" : "COACH"}: ${m.content.slice(0, 180)}`).join("\n");
  const profile = p.soulProfile.trim() ? `<user_soul_profile>\n${p.soulProfile.trim().slice(0, 1000)}\n</user_soul_profile>\n\n` : "";
  const memory = p.memory.trim() ? `<coach_memory>\n${p.memory.trim().slice(0, 700)}\n</coach_memory>\n\n` : "";
  const langLine = p.state.lang === "zh" ? "Reply in Traditional Chinese." : "Reply in English.";
  const receipt = p.state.confirmations.length
    ? `<execution_receipt>\n${p.state.confirmations.map((c) => `ACTION_EXECUTED: ${c}`).join("\n")}\n(The app shows this on a card under your words; confirm naturally, never restate it with dates.)\n</execution_receipt>`
    : `<execution_receipt>NONE</execution_receipt>\n<supported_actions>\n${supportedActions()}\n</supported_actions>`;
  return `${profile}${memory}<verified_ledger_state>\n${renderVerifiedState(p.state)}\n</verified_ledger_state>\n\n${receipt}\n\nintent=${p.intent}\n\nConversation so far:\n${history || "(first message)"}\n\nUSER: ${p.userMessage}\n\n${langLine} Write the reply.`;
}

export interface SoulResult {
  text: string;
  model: string;
  costUsd: number;
  usage: Usage;
  finishReason: string | null;
}

/**
 * Hidden-reasoning setting per model. Haiku 5.5 and GPT-6 Luna accept reasoning:off;
 * Sonnet 5.5 and Gemini 3.5 ZDR endpoints call it mandatory (400) but accept low effort,
 * which in practice spends zero reasoning tokens.
 */
export function reasoningFor(model: string): "off" | "low" {
  return /haiku|luna/i.test(model) ? "off" : "low";
}

export async function writeSoulReply(
  env: { apiKey: string; models: string[]; strong: boolean },
  p: SoulInput,
  sessionId: string,
): Promise<SoulResult | null> {
  const user = buildSoulUser(p);
  for (let i = 0; i < env.models.length; i++) {
    const models = env.models.slice(i);
    try {
      // Anthropic counts hidden reasoning against max_tokens, and Sonnet at low effort still thinks
      // a few hundred tokens on some turns, so the budget has to leave room for the line itself.
      const r = await callPlainText({ apiKey: env.apiKey }, {
        models,
        sessionId,
        maxTokens: /sonnet|opus/i.test(models[0]) ? 1400 : 400,
        system: SOUL_PROMPT,
        user,
        reasoning: reasoningFor(models[0]),
      });
      // Reasoning ate the whole budget and nothing came back: let the next writer try before code does.
      if (r.finishReason === "length" && !r.text.trim() && i < env.models.length - 1) {
        console.error("soul pass empty after length cut", models[0]);
        continue;
      }
      return { text: cutFragment(r.text, r.finishReason), model: r.model, costUsd: r.costUsd, usage: r.usage, finishReason: r.finishReason };
    } catch (error: unknown) {
      const rejected = error instanceof OpenRouterError && error.status === 400;
      console.error("soul pass failed", models[0], error instanceof OpenRouterError ? `${error.message} ${error.body ?? ""}` : String(error));
      // A parameter rejection is specific to this model; try the next one. Anything else is the gateway, so stop.
      if (!rejected) return null;
    }
  }
  return null;
}

/** When the model was cut off, drop the unfinished tail so the user never sees half a sentence. */
export function cutFragment(text: string, finishReason: string | null): string {
  if (finishReason !== "length") return text;
  const t = text.trim();
  const end = Math.max(t.lastIndexOf("."), t.lastIndexOf("?"), t.lastIndexOf("!"), t.lastIndexOf("。"), t.lastIndexOf("？"), t.lastIndexOf("！"));
  return end >= 0 ? t.slice(0, end + 1) : "";
}

/** Deterministic line for OPENROUTER_API_KEY=mock so the orchestration can be exercised offline. */
export function mockSoulLine(s: VerifiedState, intent: Intent): string {
  return fallbackWarmReply(s, intent);
}
