import { assertEquals } from "jsr:@std/assert@1";
import { dropEventEcho, dropNumberSentences, restatesTheWrite } from "./voice.ts";

Deno.test("restatements and cheerleading are dropped after a write", () => {
  for (const r of ["Logged 3 beers for you.", "Updated! You now have {logged_count} beers.", "I'll remind you Thursday.", "Saved. Have fun and stay safe!", "Great job keeping under your limit."]) {
    assertEquals(restatesTheWrite(r), true, r);
  }
});

Deno.test("lines that add something survive", () => {
  for (const r of ["Late one.", "Sam's on Friday. Want a number for that night?", "That's the third late one this week.", ""]) {
    assertEquals(restatesTheWrite(r), false, r);
  }
});

Deno.test("number sentences are dropped when code already printed the figures", () => {
  assertEquals(dropNumberSentences("{weekly_total} of {weekly_limit} so far. Fridays show up consistently."), "Fridays show up consistently.");
  assertEquals(dropNumberSentences("Two quiet nights in there."), "Two quiet nights in there.");
});

Deno.test("closing filler is treated as restatement", () => {
  assertEquals(restatesTheWrite("Got it."), true);
});

Deno.test("event restatements are dropped, the follow-up question survives", () => {
  assertEquals(dropNumberSentences("Sam's on {event_when}, noted. Want a number for that night?"), "Want a number for that night?");
});

Deno.test("event echoes are dropped after an event write", () => {
  assertEquals(dropEventEcho("Sam's in five days, noted. Want a number for that night?", "Party at Sam's"), "Want a number for that night?");
  assertEquals(restatesTheWrite("Reminders are back on."), true);
});
