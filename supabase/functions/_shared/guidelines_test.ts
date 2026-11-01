import { assert, assertEquals } from "jsr:@std/assert@1";
import { auditCBand, auditCScore, goalNote, guidelineFlags, renderGuidelineLines, thresholdsFor } from "./guidelines.ts";

Deno.test("NIAAA low-risk thresholds are sex-specific; unknown sex takes the conservative line", () => {
  assertEquals(thresholdsFor("male"), { perDay: 4, perWeek: 14, bingeIn2h: 5, auditCPositive: 4 });
  assertEquals(thresholdsFor("female"), { perDay: 3, perWeek: 7, bingeIn2h: 4, auditCPositive: 3 });
  assertEquals(thresholdsFor(null), thresholdsFor("female"));
});

Deno.test("AUDIT-C scores 0 to 12 and bands by the USPSTF/NIAAA cut-points", () => {
  assertEquals(auditCScore([0, 0, 0]), 0);
  assertEquals(auditCScore([4, 4, 4]), 12);
  assertEquals(auditCScore([2, 1, 0]), 3);
  assertEquals(auditCBand(3, "male"), "negative");
  assertEquals(auditCBand(4, "male"), "positive");
  assertEquals(auditCBand(3, "female"), "positive");
  assertEquals(auditCBand(8, "male"), "high");
  assertEquals(auditCBand(2, null), "negative");
});

Deno.test("AUDIT-C answers outside 0..4 are rejected", () => {
  let threw = false;
  try { auditCScore([5, 0, 0]); } catch { threw = true; }
  assert(threw);
});

Deno.test("binge is 5 (men) or 4 (women) drinks within two hours; heavy day is above 4 or 3", () => {
  const m = guidelineFlags({ sex: "male", drinksLast2h: 5, todayTotal: 5, weeklyTotal: 5, weeklyLimit: 14 });
  assert(m.binge); assert(m.heavyDay); assert(!m.weekOverLowRisk); assert(!m.limitAboveLowRisk);
  const f = guidelineFlags({ sex: "female", drinksLast2h: 4, todayTotal: 4, weeklyTotal: 8, weeklyLimit: 10 });
  assert(f.binge); assert(f.heavyDay); assert(f.weekOverLowRisk); assert(f.limitAboveLowRisk);
  const quiet = guidelineFlags({ sex: "male", drinksLast2h: 2, todayTotal: 2, weeklyTotal: 6, weeklyLimit: 14 });
  assert(!quiet.binge && !quiet.heavyDay && !quiet.weekOverLowRisk && !quiet.limitAboveLowRisk);
  const noData = guidelineFlags({ sex: "male", drinksLast2h: 0, todayTotal: null, weeklyTotal: 0, weeklyLimit: 14 });
  assert(!noData.heavyDay);
});

Deno.test("guideline lines name the line crossed and the source, nothing when nothing crossed", () => {
  const f = guidelineFlags({ sex: "female", drinksLast2h: 4, todayTotal: 4, weeklyTotal: 4, weeklyLimit: 7 });
  const lines = renderGuidelineLines(f, { score: 5, band: "positive" });
  assert(lines.some((l) => /binge/i.test(l) && /4 drinks/.test(l) && /NIAAA/.test(l)));
  assert(lines.some((l) => /AUDIT-C 5\/12/.test(l) && /positive/.test(l)));
  const none = renderGuidelineLines(guidelineFlags({ sex: "male", drinksLast2h: 1, todayTotal: 1, weeklyTotal: 1, weeklyLimit: 14 }), null);
  assertEquals(none, []);
});

Deno.test("a weekly limit above the NIAAA low-risk line gets a one-line note in both languages", () => {
  assertEquals(goalNote(14, "male", "en"), null);
  assert(/14 a week/.test(goalNote(20, "male", "en") ?? ""));
  assert(/7 a week/.test(goalNote(10, "female", "en") ?? ""));
  assert(/每週 7 杯/.test(goalNote(10, null, "zh") ?? ""));
});
