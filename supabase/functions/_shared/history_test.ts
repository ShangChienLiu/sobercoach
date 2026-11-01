import { assert, assertEquals } from "jsr:@std/assert@1";
import { type HistoryHit, historyTerms, renderHistoryLine } from "./history.ts";
import { SYSTEM_PROMPT, TOOL_DESCRIPTIONS, TOOL_NAMES } from "./prompt.ts";

Deno.test("search terms: the user's words, split, de-duplicated, at most three, no filler", () => {
  assertEquals(historyTerms("Dan's party"), ["dan's", "party"]);
  assertEquals(historyTerms("  what about the wedding  "), ["wedding"]);
  assertEquals(historyTerms("a b c d e f"), []);
  assertEquals(historyTerms("friday friday 4am insomnia brother"), ["friday", "4am", "insomnia"]);
  assertEquals(historyTerms("上次 Dan 的派對"), ["上次", "dan", "的派對"]);
  assertEquals(historyTerms(""), []);
});

const hits: HistoryHit[] = [
  { created_at: "2026-10-24T13:05:00Z", role: "user", content: "at Dan's I'll start with sparkling water and pace one for one", matched: 2, service_date: "2026-10-24", std_drinks: null },
  { created_at: "2026-10-18T15:30:00Z", role: "user", content: "had 4 beers at Dan's and felt awful", matched: 1, service_date: "2026-10-18", std_drinks: 4 },
];

Deno.test("history line: dated snippets in the user's words, with that day's verified total when there is one", () => {
  const line = renderHistoryLine(["dan's", "party"], hits, "en", "Asia/Taipei");
  assert(line.startsWith("Earlier about \"dan's party\":"), line);
  assert(line.includes("Oct 24 (you): \"at Dan's I'll start with sparkling water"), line);
  assert(line.includes("Oct 18 (you): \"had 4 beers at Dan's and felt awful\" [logged 4.0 that day]"), line);
});

Deno.test("history line: Chinese rendering and the empty case", () => {
  const zh = renderHistoryLine(["dan"], hits.slice(0, 1), "zh", "Asia/Taipei");
  assert(zh.startsWith("之前提到「dan」："), zh);
  assert(zh.includes("10/24（你）"), zh);
  assertEquals(renderHistoryLine(["wedding"], [], "en", "Asia/Taipei"), "Nothing earlier about \"wedding\" in our chats.");
  assertEquals(renderHistoryLine(["婚禮"], [], "zh", "Asia/Taipei"), "之前的對話裡沒有提到「婚禮」。");
});

Deno.test("history line: long snippets are cut and coach lines are labelled", () => {
  const long: HistoryHit = { created_at: "2026-10-01T10:00:00Z", role: "assistant", content: "x".repeat(300), matched: 1, service_date: "2026-10-01", std_drinks: null };
  const line = renderHistoryLine(["x"], [long], "en", "Asia/Taipei");
  assert(line.includes("(coach): \"" + "x".repeat(140) + "…\""), line);
});

Deno.test("search_history is a registered tool the AGENTS prompt teaches", () => {
  assert((TOOL_NAMES as ReadonlyArray<string>).includes("search_history"));
  assert(TOOL_DESCRIPTIONS.search_history.length > 0);
  assert(/search_history \{text:/.test(SYSTEM_PROMPT));
  assert(/never invent a memory/i.test(SYSTEM_PROMPT));
});
