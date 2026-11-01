import { assertEquals } from "jsr:@std/assert@1";
import {
  addDays,
  eveningOfServiceDay,
  inQuietHours,
  instantAtLocal,
  labelServiceDate,
  resolveRelativeDay,
  serviceDate,
} from "./service_day.ts";

const TZ = "America/Los_Angeles";

Deno.test("01:30 Saturday local belongs to Friday's service day with 04:00 rollover", () => {
  // 2026-10-31 01:30 PDT = 08:30Z
  const d = new Date("2026-10-31T08:30:00Z");
  assertEquals(serviceDate(d, TZ, 4), "2026-10-30");
});

Deno.test("04:00 exactly starts the new service day", () => {
  const d = new Date("2026-10-31T11:00:00Z"); // 04:00 PDT
  assertEquals(serviceDate(d, TZ, 4), "2026-10-31");
});

Deno.test("rollover 0 is plain calendar date", () => {
  const d = new Date("2026-10-31T08:30:00Z");
  assertEquals(serviceDate(d, TZ, 0), "2026-10-31");
});

Deno.test("yesterday is always current service day minus one", () => {
  const lateNight = new Date("2026-10-31T08:30:00Z"); // 01:30 Sat, service Fri
  assertEquals(resolveRelativeDay("yesterday", lateNight, TZ, 4), "2026-10-29");
  const morning = new Date("2026-10-31T17:00:00Z"); // 10:00 Sat
  assertEquals(resolveRelativeDay("yesterday", morning, TZ, 4), "2026-10-30");
});

Deno.test("last night before rollover is the ongoing service day", () => {
  const lateNight = new Date("2026-10-31T08:30:00Z"); // 01:30 Sat
  assertEquals(resolveRelativeDay("last_night", lateNight, TZ, 4), "2026-10-30");
  const morning = new Date("2026-10-31T17:00:00Z"); // 10:00 Sat
  assertEquals(resolveRelativeDay("last_night", morning, TZ, 4), "2026-10-30");
});

Deno.test("addDays handles month boundaries", () => {
  assertEquals(addDays("2026-10-31", 1), "2026-11-01");
  assertEquals(addDays("2026-11-01", -1), "2026-10-31");
});

Deno.test("instantAtLocal round-trips through serviceDate", () => {
  const inst = instantAtLocal("2026-10-30", 21, 0, TZ);
  assertEquals(serviceDate(inst, TZ, 4), "2026-10-30");
  assertEquals(serviceDate(eveningOfServiceDay("2026-10-30", TZ), TZ, 4), "2026-10-30");
});

Deno.test("instantAtLocal across DST fall-back (Nov 1 2026)", () => {
  const inst = instantAtLocal("2026-11-02", 9, 0, TZ);
  // 09:00 PST = 17:00Z
  assertEquals(inst.toISOString(), "2026-11-02T17:00:00.000Z");
});

Deno.test("labelServiceDate names the exact date", () => {
  assertEquals(labelServiceDate("2026-10-30", TZ), "Fri, Oct 30");
});

Deno.test("quiet hours wrap midnight", () => {
  const at23 = new Date("2026-10-31T06:00:00Z"); // 23:00 PDT
  const at10 = new Date("2026-10-31T17:00:00Z"); // 10:00 PDT
  assertEquals(inQuietHours(at23, TZ, 22, 9), true);
  assertEquals(inQuietHours(at10, TZ, 22, 9), false);
});
