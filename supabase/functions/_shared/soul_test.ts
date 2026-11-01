import { assert, assertEquals } from "jsr:@std/assert@1";
import { allowedNumbers, buildSoulUser, cutFragment, fallbackWarmReply, postProcessSoulReply, reasoningFor, renderVerifiedState, shouldEscalateToSonnet, usedHooks, type VerifiedState } from "./soul.ts";

const base: VerifiedState = {
  lang: "en", localHour: 20, weekday: "Fri",
  weeklyTotal: 4, weeklyLimit: 8, weeklyRemaining: 4, weeklyEstimated: true, daysWithData: 2,
  todayTotal: 2, todayDry: false, entriesLast2h: 1, drinksLast2h: 2,
  logged: { count: 2, beverage: "beer", dayLabel: "Fri, Oct 30", std: 2, estimated: true },
  nextEvent: { title: "Party at Sam's", whenLabel: "Wed, Nov 4, 8:00 PM", daysUntil: 5, hoursUntil: 120 },
  summary: null, factLine: null, confirmations: ["Logged 2 beers for Fri, Oct 30, ~2.0 std drinks (est.)."],
};

Deno.test("openers and receipts are stripped, the human line survives", () => {
  const r = postProcessSoulReply("Got it! Logged 2 beers. That leaves four for the weekend. Out with people?", allowedNumbers(base), "en");
  assertEquals(r.text, "That leaves four for the weekend. Out with people?");
  assert(r.note?.includes("opener_stripped"));
});

Deno.test("a sentence with an unverified figure is removed, not the whole reply", () => {
  const r = postProcessSoulReply("That leaves 6 for the week. Unwinding after the week, or out with people?", allowedNumbers(base), "en");
  assertEquals(r.text, "Unwinding after the week, or out with people?");
  assert(r.note?.includes("unverified_number_sentence_removed"));
});

Deno.test("verified figures pass, including the user's own numbers and times", () => {
  const allowed = allowedNumbers(base, "I keep waking up at 4am");
  const r = postProcessSoulReply("4 of 8 left and Sam's is in 5 days. Still waking at 4am?", allowed, "en");
  assertEquals(r.note, null);
  assertEquals(r.text, "4 of 8 left and Sam's is in 5 days. Still waking at 4am?");
});

Deno.test("only the first question survives and exclamation marks are calmed", () => {
  const r = postProcessSoulReply("Rough day? Or just winding down tonight? Either way!", allowedNumbers(base), "en");
  assertEquals(r.text, "Rough day? Either way.");
  assert(r.note?.includes("second_question_removed"));
});

Deno.test("wrong language becomes empty so code can fall back", () => {
  const r = postProcessSoulReply("That leaves four for the weekend.", allowedNumbers(base), "zh");
  assertEquals(r.text, "");
  assert(r.note?.includes("wrong_language"));
  const zh = postProcessSoulReply("好的，已記錄。週末還有四杯的空間，今晚是什麼場合？", allowedNumbers(base), "zh");
  assertEquals(zh.text, "週末還有四杯的空間，今晚是什麼場合？");
});

Deno.test("fallback lines use verified figures only and match the language", () => {
  const en = fallbackWarmReply(base, "log");
  assert(en.includes("4") && en.includes("8"), en);
  const over = fallbackWarmReply({ ...base, weeklyRemaining: -1.5 }, "log");
  assert(over.includes("past the 8"), over);
  const zh = fallbackWarmReply({ ...base, lang: "zh" }, "emotional");
  assert(/[一-鿿]/.test(zh));
  for (const intent of ["log", "edit", "reflect", "emotional", "query", "chat"] as const) {
    const guard = postProcessSoulReply(fallbackWarmReply(base, intent), allowedNumbers(base), "en");
    assertEquals(guard.text, fallbackWarmReply(base, intent), `fallback for ${intent} must pass its own guard`);
  }
});

Deno.test("routing: emotional and reflective turns, over-goal, pacing and late-night logs go strong; the cap wins", () => {
  const cap = { dailyStrongCount: 0, cap: 10 };
  assertEquals(shouldEscalateToSonnet({ intent: "emotional", state: base, wrote: false, ...cap }).reason, "emotional");
  assertEquals(shouldEscalateToSonnet({ intent: "reflect", state: base, wrote: false, ...cap }).reason, "reflect");
  assertEquals(shouldEscalateToSonnet({ intent: "log", state: base, wrote: true, ...cap }).escalate, false);
  assertEquals(shouldEscalateToSonnet({ intent: "log", state: { ...base, weeklyRemaining: -0.5 }, wrote: true, ...cap }).reason, "over_goal");
  assertEquals(shouldEscalateToSonnet({ intent: "log", state: { ...base, entriesLast2h: 2 }, wrote: true, ...cap }).reason, "rapid_pacing");
  assertEquals(shouldEscalateToSonnet({ intent: "log", state: { ...base, localHour: 23 }, wrote: true, ...cap }).reason, "late_night");
  assertEquals(shouldEscalateToSonnet({ intent: "log", state: { ...base, localHour: 1 }, wrote: true, ...cap }).reason, "late_night");
  assertEquals(shouldEscalateToSonnet({ intent: "chat", state: { ...base, localHour: 1 }, wrote: false, ...cap }).escalate, false);
  assertEquals(shouldEscalateToSonnet({ intent: "emotional", state: base, wrote: false, dailyStrongCount: 10, cap: 10 }), { escalate: false, reason: "strong_capped" });
});

Deno.test("the verified state renders the figures the writer may cite", () => {
  const text = renderVerifiedState({ ...base, weeklyRemaining: -1, entriesLast2h: 2 });
  assert(text.includes("remaining=-1.0 (OVER)"));
  assert(text.includes("pacing: 2 separate logs"));
  const user = buildSoulUser({ state: { ...base, weeklyRemaining: -1, entriesLast2h: 2 }, intent: "log", userMessage: "2 beers", soulProfile: "", memory: "", history: [] });
  assert(user.includes("ACTION_EXECUTED: Logged 2 beers"), "receipt block carries the confirmation");
  const none = buildSoulUser({ state: { ...base, confirmations: [] }, intent: "query", userMessage: "notify me on November 1", soulProfile: "", memory: "", history: [] });
  assert(none.includes("<execution_receipt>NONE</execution_receipt>") && none.includes("save a future event or a dated reminder"), "no receipt shows the registry-derived actions");
});

Deno.test("the light writer's receipt echoes are dropped when it also says something human", () => {
  const conf = ["All reminders back on."];
  const r = postProcessSoulReply("All reminders back on. The Sam's party is still on the calendar for Thursday at 8, with a nudge at 5.", allowedNumbers(base, "", "Thursday at 8 nudge at 5"), "en", conf);
  assertEquals(r.text, "The Sam's party is still on the calendar for Thursday at 8, with a nudge at 5.");
  assert(r.note?.includes("restatement_removed"));
  const logged = postProcessSoulReply("Two cocktails logged for Sat, Oct 31. Still up at this hour, what's keeping you going?", allowedNumbers(base), "en", ["Logged 2 cocktails for Sat, Oct 31, ~2.0 std drinks (est.)."]);
  assertEquals(logged.text, "Still up at this hour, what's keeping you going?");
});

Deno.test("re-listing figures that are already on screen is dropped; the fresh thought survives", () => {
  const fact = ["This week (Sun, Oct 25 – Sat, Oct 31): 14.0 of 8 standard drinks (est.). 5 days with no data."];
  const s2 = { ...base, weeklyTotal: 14, weeklyRemaining: -6, daysWithData: 2 };
  const r = postProcessSoulReply("This week you're at 14.0 of 8 standard drinks, so you're over by 6.0, and five days have no data logged. Worth knowing before you decide what the next few hours look like.", allowedNumbers(s2), "en", fact);
  assertEquals(r.text, "Worth knowing before you decide what the next few hours look like.");
});

Deno.test("a receipt alone is never blanked by the restatement rule", () => {
  const r = postProcessSoulReply("Fixed, that gives you one back on the week.", allowedNumbers(base), "en", ["Updated: 3 → 2 beers on Fri, Oct 30."]);
  assertEquals(r.text, "Fixed, that gives you one back on the week.");
});

Deno.test("routine turns are capped at two sentences", () => {
  const r = postProcessSoulReply("One. Two. Three?", allowedNumbers(base), "en", [], 2);
  assertEquals(r.text, "One. Two.");
  assert(r.note?.includes("trimmed_to_2_sentences"));
});

Deno.test("a worn hook is dropped when the last coach lines already used it", () => {
  const tired = usedHooks(["Five left for the week, and it's only 5 a.m.", "Wine at 5am on a Saturday."]);
  assert(tired.has("clock_time"));
  const r = postProcessSoulReply("You're at four since two hours ago and it's 5am. When did you last sleep?", allowedNumbers({ ...base, drinksLast2h: 4 }), "en", [], 2, tired);
  assertEquals(r.text, "When did you last sleep?");
  assert(r.note?.includes("repeated_hook_removed"));
  const fresh = postProcessSoulReply("It's 5am and you're still up. When did you last sleep?", allowedNumbers(base), "en", [], 2, new Set());
  assertEquals(fresh.note, null);
});

Deno.test("a line that is nothing but a receipt echo is handed back to code", () => {
  const r = postProcessSoulReply("Undone, the Friday glass is back off the books.", allowedNumbers(base), "en", ["Removed 1 glass of wine from Sat, Oct 31."], 2);
  assertEquals(r.text, "");
  assert(r.note?.includes("all_restatement"));
});

Deno.test("receipt paraphrases are caught even without word overlap", () => {
  const conf = ["Updated: 3 → 2 beers on Sat, Oct 31."];
  const r = postProcessSoulReply("Two it is, that leaves six for the week. How are you feeling after those?", allowedNumbers(base), "en", conf, 2);
  assertEquals(r.text, "Two it is, that leaves six for the week. How are you feeling after those?");
  const undo = postProcessSoulReply("Off the wine from Saturday.", allowedNumbers(base), "en", ["Removed 1 glass of wine from Sat, Oct 31."], 2);
  assertEquals(undo.text, "");
  const moved = postProcessSoulReply("Those belong to Friday. Want me to move them there?", allowedNumbers(base), "en", ["Updated: 2 beers moved to Fri, Oct 30."], 2);
  assertEquals(moved.text, "");
  const zh = postProcessSoulReply("我記下了，不過今天是凌晨五點，還沒睡嗎？", allowedNumbers({ ...base, lang: "zh" }), "zh", ["已記錄 10/31（六） 2 杯紅白酒。"], 2);
  assertEquals(zh.text, "不過今天是凌晨五點，還沒睡嗎？");
});

Deno.test("reasoning is switched off only where the endpoint allows it", () => {
  assertEquals(reasoningFor("anthropic/claude-haiku-5.5"), "off");
  assertEquals(reasoningFor("openai/gpt-6-luna"), "off");
  assertEquals(reasoningFor("anthropic/claude-sonnet-5.5"), "low");
  assertEquals(reasoningFor("google/gemini-3.5-flash-lite"), "low");
});

Deno.test("routine logs lose their trailing question when a statement remains", () => {
  const r = postProcessSoulReply("Two on the board, four left for the weekend. How are you feeling after those?", allowedNumbers(base), "en", ["Logged 2 beers for Fri, Oct 30."], 2, new Set(), 0);
  assertEquals(r.text, "Two on the board, four left for the weekend.");
  assert(r.note?.includes("routine_question_removed"));
  const only = postProcessSoulReply("How was the night?", allowedNumbers(base), "en", ["Logged 2 beers for Fri, Oct 30."], 2, new Set(), 0);
  assertEquals(only.text, "How was the night?");
});

Deno.test("a moved-entry paraphrase is treated as a receipt", () => {
  const r = postProcessSoulReply("Moved to Friday where they belong, and the six left for the week still holds. Hope the morning's treating you gently.", allowedNumbers(base), "en", ["Updated: 2 beers moved to Fri, Oct 30."], 2, new Set(), 0);
  assertEquals(r.text, "Hope the morning's treating you gently.");
});

Deno.test("leaked self-talk about the instructions is removed", () => {
  const r = postProcessSoulReply("Friday stayed light compared with what you've told me. Wait, I need to keep this to one short sentence under twelve words.", allowedNumbers(base), "en", [], 2);
  assertEquals(r.text, "Friday stayed light compared with what you've told me.");
  assert(r.note?.includes("meta_removed"));
});

Deno.test("a cut-off reply loses its unfinished tail", () => {
  assertEquals(cutFragment("Starting today is a clear line to draw. Should I set your weekly limit to zero, or turn on a daily re", "length"), "Starting today is a clear line to draw.");
  assertEquals(cutFragment("Should I set your limit to zero, or turn on a daily re", "length"), "");
  assertEquals(cutFragment("Fine as is", "stop"), "Fine as is");
  assertEquals(cutFragment("這週還有六杯。今晚是什麼場", "length"), "這週還有六杯。");
});
