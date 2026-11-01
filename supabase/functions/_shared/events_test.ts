import { assertEquals } from "jsr:@std/assert@1";
import { defaultHourFor, eventKindFor, nudgeAt, resolveEventDateTime } from "./events.ts";

Deno.test("reminders and drinking occasions are told apart from the user's words", () => {
  assertEquals(eventKindFor("remind me friday to call mom", "call mom"), "general_reminder");
  assertEquals(eventKindFor("Notify, me on November 1", "Reminder"), "general_reminder");
  assertEquals(eventKindFor("remind me thursday 2am don't buy beer", "Don't buy beer"), "general_reminder");
  assertEquals(eventKindFor("party at Sam's in 5 days", "Party at Sam's"), "drinking_social");
  assertEquals(eventKindFor("下週五要去阿明家聚餐", "阿明家聚餐"), "drinking_social");
  assertEquals(eventKindFor("提醒我週五打給媽媽", "打給媽媽"), "general_reminder");
  assertEquals(eventKindFor("remind me about the wedding saturday", "wedding"), "drinking_social");
});

Deno.test("a day without a time gets the kind's default hour, in the user's timezone", () => {
  const now = new Date("2026-11-01T00:30:00+08:00");
  const reminder = resolveEventDateTime({ date: "2026-11-01", time: null, daysFromNow: null, kind: "general_reminder", now, tz: "Asia/Taipei" });
  assertEquals(reminder.toISOString(), "2026-11-01T04:00:00.000Z"); // 12:00 Taipei
  const party = resolveEventDateTime({ date: null, time: null, daysFromNow: 5, kind: "drinking_social", now, tz: "Asia/Taipei" });
  assertEquals(party.toISOString(), "2026-11-06T12:00:00.000Z"); // 20:00 Taipei
  const timed = resolveEventDateTime({ date: "2026-11-05", time: "02:00", daysFromNow: null, kind: "general_reminder", now, tz: "Asia/Taipei" });
  assertEquals(timed.toISOString(), "2026-11-04T18:00:00.000Z");
  assertEquals(defaultHourFor("drinking_social"), 20);
});

Deno.test("reminders nudge at their time, drinking occasions three hours before", () => {
  const at = new Date("2026-11-06T04:00:00Z");
  assertEquals(nudgeAt(at, "general_reminder").toISOString(), "2026-11-06T04:00:00.000Z");
  assertEquals(nudgeAt(at, "drinking_social").toISOString(), "2026-11-06T01:00:00.000Z");
});
