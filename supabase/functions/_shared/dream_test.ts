import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDreamUser, normalizeProfile, SOUL_PROFILE_MAX_CHARS } from "./dream.ts";

Deno.test("dream input carries the raw record the consolidator needs", () => {
  const text = buildDreamUser({
    soulProfile: "", memory: "- cutting down because of 4am wake-ups", weeklyLimit: 8, timezone: "America/Los_Angeles",
    dailyTotals: [{ service_date: "2026-10-30", std_drinks: 2, confirmed_dry: false, active_entries: 1 }, { service_date: "2026-10-31", std_drinks: 0, confirmed_dry: true, active_entries: 0 }],
    events: [{ title: "Party at Sam's", starts_at: "2026-11-04T20:00:00-08:00" }],
    messages: [{ role: "user", content: "3 beers" }, { role: "assistant", content: "Logged 3 beers for Fri, Oct 30." }],
  });
  assert(text.includes("2026-10-30: 2.0 std"));
  assert(text.includes("2026-10-31: dry (marked)"));
  assert(text.includes("weekly_limit=8"));
  assert(text.includes("Party at Sam's"));
  assert(text.includes("USER: 3 beers"));
});

Deno.test("profiles are fenced-free and capped at the stored size", () => {
  assertEquals(normalizeProfile("```\n1. Vibe: short.\n```"), "1. Vibe: short.");
  const long = normalizeProfile("word ".repeat(600));
  assert(long.length <= SOUL_PROFILE_MAX_CHARS);
});
