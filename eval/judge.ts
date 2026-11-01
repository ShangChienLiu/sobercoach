// Tone judge: scores a saved tone transcript line by line with a stronger model.
// Used only to iterate the voice, never to pick the production model.
//   OPENROUTER_API_KEY=... deno run -A eval/judge.ts eval/results/tone-<label>-<stamp>.json
const file = Deno.args[0];
if (!file) { console.error("usage: judge.ts <transcript.json>"); Deno.exit(2); }
const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const rows = JSON.parse(await Deno.readTextFile(file)) as Array<{ user: string; coach: string; tier: string }>;
const RUBRIC = `You are judging replies from a drink-tracking companion app that wants to feel like a close, perceptive friend texting (the register of an always-on personal agent such as OpenAI Dots, Meta Muse or Grok Bot). Lines that start with "Logged", "Updated", "Saved", "Removed", "Restored", "Weekly limit set", "All reminders", "This week (", "Today:", "No reminder", "Last reminder" or their Chinese equivalents (已記錄, 已更新, 已存, 本週) are printed by code and are fine; judge the words after them. After a log, a good reply acknowledges lightly and touches the human moment in one or two sentences; an empty reply or a bare receipt is a 2 on specific and warm_not_cheer.
Score each coach reply 1-5 on:
brevity (one or two sentences, no padding), no_restating (does not repeat the code line's count or date as a receipt, does not parrot the user), specific (refers to this user's actual situation, names, memory, verified numbers used naturally), warm_not_cheer (kind, perceptive, zero cheerleading, zero scolding, no therapy-speak), language (same language as the user; natural), question_discipline (at most one question, and it opens something real).
Also flag: cliche (true if it contains filler like Got it, Great job, I'm here for you, Remember to, Stay safe, Thanks for sharing), judgmental (true if it moralizes).
Return JSON: {"scores":[{"i":0,"brevity":5,"no_restating":5,"specific":4,"warm_not_cheer":5,"language":5,"question_discipline":5,"cliche":false,"judgmental":false,"better":"<rewrite in the ideal voice, max 30 words, or empty if already ideal>"}, ...]}`;
const convo = rows.map((r, i) => `[${i}] USER: ${r.user}\n[${i}] COACH: ${r.coach || "(silence)"}`).join("\n\n");
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "anthropic/claude-sonnet-5.5",
    messages: [{ role: "system", content: RUBRIC }, { role: "user", content: convo }],
    max_tokens: 16000,
    response_format: { type: "json_object" },
    provider: { zdr: true, data_collection: "deny" },
    usage: { include: true },
  }),
});
const j = await res.json();
if (j.error) { console.error(j.error); Deno.exit(1); }
const text: string = j.choices[0].message.content;
const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/, ""));
import { trackOf } from "./tracks.ts";
const axes = ["brevity", "no_restating", "specific", "warm_not_cheer", "language", "question_discipline"] as const;
const scores: Array<Record<string, unknown>> = parsed.scores;
const mean: Record<string, number> = {};
for (const a of axes) mean[a] = scores.reduce((s, r) => s + Number(r[a] ?? 0), 0) / scores.length;
const overall = axes.reduce((s, a) => s + mean[a], 0) / axes.length;
console.log(`judge cost $${j.usage?.cost?.toFixed(4)} · ${scores.length} lines`);
console.log("means:", Object.fromEntries(axes.map((a) => [a, mean[a].toFixed(2)])), "overall", overall.toFixed(2));
console.log("cliches:", scores.filter((r) => r.cliche).length, "judgmental:", scores.filter((r) => r.judgmental).length);
for (const t of ["A", "B"] as const) {
  const sub = scores.filter((r) => trackOf(rows[Number(r.i)]?.user ?? "") === t);
  const o = sub.length ? axes.reduce((s, a) => s + sub.reduce((x, r) => x + Number(r[a] ?? 0), 0) / sub.length, 0) / axes.length : 0;
  console.log(`track ${t} (${t === "A" ? "coaching" : "routine"}): ${sub.length} lines, overall ${o.toFixed(2)}`);
}
const weak = scores.map((r) => ({ i: Number(r.i), better: String(r.better ?? ""), min: Math.min(...axes.map((a) => Number(r[a] ?? 0))) })).filter((r) => r.min <= 3).sort((a, b) => a.min - b.min);
for (const w of weak) {
  const i = Number(w.i);
  console.log(`\n[${i}] min ${w.min} · USER: ${rows[i]?.user}\n    COACH: ${rows[i]?.coach || "(silence)"}\n    BETTER: ${w.better}`);
}
await Deno.writeTextFile(file.replace(/\.json$/, ".judge.json"), JSON.stringify({ mean, overall, scores }, null, 2));
