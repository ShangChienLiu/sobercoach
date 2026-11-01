// Tone review: drives one realistic conversation through the chat function and
// prints what the user would see, so a human can judge the voice.
//   deno run -A eval/tone.ts --url https://<ref>.supabase.co --anon <key> [--email blake@test.sobercoach.app]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
const args = parseArgs(Deno.args, { string: ["url", "anon", "email", "password", "label"], default: { email: "blake@test.sobercoach.app", password: "sobercoach-test" } });
const BASE = (args.url ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const ANON = args.anon ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: args.email, password: args.password }) });
const { access_token } = await res.json();
const H = { apikey: ANON, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
async function chat(body: Record<string, unknown>) {
  const r = await fetch(`${BASE}/functions/v1/chat`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  return j.data ?? { reply: `ERROR ${j.error}`, tier: "-", route_reason: "-", cost_usd: 0, latency_ms: 0 };
}
await chat({ action: { type: "reset_test_data" } });
const script: Array<string | Record<string, unknown>> = [
  "hey",
  "3 beers",
  "actually it was 2",
  "those were last night",
  "I'm trying to cut down because I keep waking up at 4am. Fridays are the problem.",
  "glass of wine",
  "party at Sam's in 5 days",
  "did you remind me?",
  "how's my week going",
  "I feel like crap today",
  "what's the weather like",
  "stop reminding me",
  "turn reminders back on",
  "remind me thursday 2am don't buy beer",
  "set my limit to 8",
  "why do I always end up drinking more on fridays",
  "undo",
  "ok thanks",
  "I blew it last night. 8 beers and I don't even remember getting home.",
  "I feel like an idiot",
  "3 dry days in a row",
  "I really want a drink right now",
  "it's 1am and I can't sleep",
  "my brother keeps pushing shots on me when we go out",
  "you're kind of annoying",
  "help me plan for Sam's party",
  "我今天喝了兩杯紅酒",
  "我覺得我做不到",
  "what should I drink instead at the party",
  "2 cocktails",
  "how many have I had this week",
  "I don't want to log today",
  "my wife noticed I've been drinking less",
  "what's a standard drink",
  "goodnight",
];
const transcript: Array<{ user: string; coach: string; tier: string; cost: number }> = [];
let total = 0;
for (const step of script) {
  const body = typeof step === "string" ? { message: step } : step;
  const d = await chat(body);
  total += d.cost_usd ?? 0;
  console.log(`\nYOU: ${typeof step === "string" ? step : JSON.stringify(step)}`);
  console.log(`COACH: ${d.reply || "(silence)"}`);
  console.log(`   · ${d.tier} · ${d.model ?? "code"} · ${d.route_reason} · $${(d.cost_usd ?? 0).toFixed(4)} · ${d.latency_ms} ms`);
  transcript.push({ user: typeof step === "string" ? step : JSON.stringify(step), coach: d.reply ?? "", tier: d.tier, cost: d.cost_usd ?? 0 });
}
await Deno.mkdir(new URL("./results/", import.meta.url), { recursive: true });
const out = new URL(`./results/tone-${args.label ?? "run"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
await Deno.writeTextFile(out, JSON.stringify(transcript, null, 2));
console.log(`saved ${out.pathname}`);
console.log(`\nTOTAL $${total.toFixed(4)} for ${script.length} turns`);
