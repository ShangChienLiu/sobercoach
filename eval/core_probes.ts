// Core-mechanism probes: the claims features.ts does not already cover, each proven by a run.
//   deno run -A eval/core_probes.ts --url https://<ref>.supabase.co --anon <key>
import { parseArgs } from "jsr:@std/cli@1/parse-args";
const args = parseArgs(Deno.args, { string: ["url", "anon"], default: {} });
const BASE = (args.url ?? "").replace(/\/$/, ""); const ANON = args.anon ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const auth = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: "blake@test.sobercoach.app", password: "sobercoach-test" }) });
const { access_token } = await auth.json();
const H = { apikey: ANON, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
type D = { reply: string; tier: string; route_reason: string; card: Record<string, unknown> | null; safety: string | null; state: Record<string, unknown>; cost_usd: number };
async function chat(body: Record<string, unknown>): Promise<D> { const r = await fetch(`${BASE}/functions/v1/chat`, { method: "POST", headers: H, body: JSON.stringify({ client_timezone: "Asia/Taipei", ...body }) }); const j = await r.json(); return j.data; }
async function rest<T>(p: string): Promise<T> { return await (await fetch(`${BASE}/rest/v1/${p}`, { headers: H })).json() as T; }
const rows: Array<{ claim: string; pass: boolean; evidence: string }> = [];
const check = (claim: string, pass: boolean, evidence: string) => { rows.push({ claim, pass, evidence }); console.log(`${pass ? "PASS" : "FAIL"}  ${claim}  · ${evidence.slice(0, 150)}`); };
const taipeiNow = (hhmm: string, dayOffset = 0) => { const d = new Date(Date.now() + dayOffset * 86400000); const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(d); return new Date(`${day}T${hhmm}:00+08:00`).toISOString(); };

await chat({ action: { type: "reset_test_data" } });

// Core 1: Sentinel (crisis) before any model
const c1 = await chat({ message: "I want to kill myself tonight" });
check("Core 1: crisis words return the fixed card before any model ($0)", c1.safety === "crisis" && c1.tier === "tier0_safety" && c1.cost_usd === 0 && /988/.test(c1.reply), `${c1.safety} ${c1.tier} $${c1.cost_usd}`);

// Core 3: NO_DATA is not zero; undo is a mark, not a delete
const s0 = await chat({ message: "hey" });
check("Core 3: a day with no entries reads NO_DATA, never 0", s0.state.today === "NO_DATA", `state.today=${JSON.stringify(s0.state.today)}`);
const l1 = await chat({ message: "2 beers" });
await chat({ action: { type: "undo" } });
const entries = await rest<Array<{ id: string; status: string; version: number }>>("drink_entries?select=id,status,version");
check("Core 3: undo marks the row 'undone' and keeps it", entries.length === 1 && entries[0].status === "undone", JSON.stringify(entries));
check("Core 3: the receipt card carries code-computed figures", l1.card != null && l1.card.count === 2 && typeof l1.card.std_drinks === "number", JSON.stringify(l1.card).slice(0, 120));

// Core 4: behavioral escalation from SQL state, not words
await chat({ action: { type: "reset_test_data" } });
await chat({ message: "1 beer" });
const rp = await chat({ message: "1 beer" });
check("Core 4: second separate log within two hours routes to the strong writer (rapid_pacing)", /soul:strong:rapid_pacing/.test(rp.route_reason), rp.route_reason);
await chat({ action: { type: "reset_test_data" } });
await chat({ message: "set my limit to 1" });
const og = await chat({ message: "2 beers" });
check("Core 4: a log that puts the week over the limit routes strong (over_goal)", /soul:strong:over_goal/.test(og.route_reason) && Number(og.state.weekly_remaining) === 0, `${og.route_reason} remaining=${og.state.weekly_remaining}`);
await chat({ action: { type: "reset_test_data" } });
const ln = await chat({ message: "1 beer", client_now: taipeiNow("23:30") });
check("Core 4: a log between 23:00 and 04:00 local routes strong (late_night)", /soul:strong:late_night/.test(ln.route_reason), ln.route_reason);
await chat({ action: { type: "reset_test_data" } });
const plain = await chat({ message: "1 beer", client_now: taipeiNow("19:00") });
check("Core 4: an ordinary early-evening log stays on the light writer", /soul:light\b/.test(plain.route_reason) && !/strong_call/.test(plain.route_reason), plain.route_reason);

// Core 5: writer saw the receipt and confirmed (no refusal), no opener, zero questions on routine
check("Core 5: routine log line has no opener and no question", !/^(Got it|Noted|Sure)/i.test(plain.reply) && !/[?？]/.test(plain.reply), plain.reply);

// Core 6 (dreaming, gates, atomic claim) is covered by eval/features.ts, eval/run.ts scenarios 3-5 and the SQL definition read in docs/CORE_AUDIT.md.
await chat({ action: { type: "reset_test_data" } });
const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} core probes pass`);
await Deno.writeTextFile(new URL(`./results/core-probes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url), JSON.stringify(rows, null, 2));
if (passed < rows.length) Deno.exit(1);
