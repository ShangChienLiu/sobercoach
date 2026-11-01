// Pairwise benchmark: for each turn of a saved tone transcript, a strong model
// writing as a top-tier companion app (Dot / Muse register) produces a reference
// reply with the same facts; a blind, order-randomized judge then prefers A, B or
// tie. Reports how often the cheap production line wins or ties the reference.
//   OPENROUTER_API_KEY=... deno run -A eval/pairwise.ts eval/results/tone-<label>-<stamp>.json
const file = Deno.args[0];
const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
// Optional: --ref <transcript.json> compares against that transcript's coach lines (e.g. a real product) instead of a generated reference.
// Optional: --style dots|muse|companion picks the register the reference writer imitates (default companion).
const refArg = Deno.args.indexOf("--ref");
const refFile = refArg >= 0 ? Deno.args[refArg + 1] : null;
import { trackOf } from "./tracks.ts";
// Optional: --judge generic|constitution. The generic judge is a plain "which reads more like a great friend-coach" question;
// the constitution judge is given the product's own rules (zero openers and emojis, no reflexive check-in after routine logs,
// grounded continuity, one question only on hard moments). Both are blind and order-swapped.
const judgeArg = Deno.args.indexOf("--judge");
const JUDGE_KIND = (judgeArg >= 0 ? Deno.args[judgeArg + 1] : "generic") as "generic" | "constitution";
const styleArg = Deno.args.indexOf("--style");
const STYLE = (styleArg >= 0 ? Deno.args[styleArg + 1] : "companion") as "dots" | "muse" | "companion";
const refRows = refFile ? JSON.parse(await Deno.readTextFile(refFile)) as Array<{ user: string; coach: string }> : null;
let rows = JSON.parse(await Deno.readTextFile(file)) as Array<{ user: string; coach: string; tier: string }>;
if (refRows) rows = rows.slice(0, refRows.length);
// The reference writer and the judge are different vendors so the judge cannot favor its own prose.
const WRITER_MODEL = Deno.env.get("WRITER_MODEL") ?? "anthropic/claude-sonnet-5.5";
const JUDGE_MODEL = Deno.env.get("JUDGE_MODEL") ?? "openai/gpt-6.1-sol";
async function ask(system: string, user: string, maxTokens = 400, model = WRITER_MODEL): Promise<{ text: string; cost: number }> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, provider: { zdr: true, data_collection: "deny" }, usage: { include: true } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  const content = j.choices?.[0]?.message?.content;
  return { text: typeof content === "string" ? content.trim() : "", cost: j.usage?.cost ?? 0 };
}
const STYLES: Record<typeof STYLE, string> = {
  companion: `You write the replies for the best companion app in the world: a close friend texting. One or two sentences (12 to 35 words), specific to this person, warm with zero cheerleading or therapy-speak, at most one question and only when it helps, same language as the user.`,
  dots: `You write the replies for an always-on personal agent in the style of OpenAI Dots: it has been quietly keeping notes about this person between chats, so every reply shows continuity (it remembers why they are cutting down, which nights are hard, what is coming up) and offers one subtle, well-timed nudge rather than advice. One or two sentences (12 to 35 words), same language as the user, at most one question.`,
  muse: `You write the replies for a bio-mindful companion in the style of Meta Muse: calm, non-judgmental, attentive to body and pacing (sleep, time of night, how fast the drinks are coming, stress and fatigue) without ever giving medical advice. One or two sentences (12 to 35 words), same language as the user, at most one question, zero scolding.`,
};
const WRITER = `${STYLES[STYLE]} The app prints its own confirmation line for logs (e.g. "Logged 3 beers for Fri, Oct 30") before your words; keep that line exactly as given and write only what comes after it. Any number you mention must come from the conversation or that line. Reply with the final text only.`;
const JUDGE_GENERIC = `You compare two replies from a drink-tracking companion app to the same user message, given the conversation so far. Judge which reads more like a close, perceptive friend who happens to be a great coach: one or two sentences, specific to this person (their situation, memory, the time of night), warm without cheerleading or scolding, no bare receipts or restating, same language as the user, at most one question and only when it opens something. A reply that is silent after a log is worse than a light, human acknowledgement. If the two replies are equally good, answer TIE. Answer with exactly one token: A, B or TIE.`;
const JUDGE_CONSTITUTION = `You compare two replies from a harm-reduction drinking coach to the same user message, given the conversation so far, against the product's constitution:
1. Zero service openers ("Got it", "Noted", "Sure", "Great job"), no emojis, no exclamation marks, no cheerleading and no scolding.
2. Routine turns (a log, a correction, a setting change, a greeting, a data question): a light, low-friction acknowledgement; a reflexive "How are you feeling?" after every entry is a cost, not warmth, because it becomes notification fatigue by day fourteen of daily use.
3. Grounded continuity: a natural reference to this user's known context (which nights are hard, who pushes drinks, what is coming up, why they are cutting down) earns credit; invented facts, or offers to do something the app cannot do, lose it.
4. Any number must be consistent with the conversation and the app's own lines.
5. Hard moments (shame, cravings, insomnia, a blackout, pressure from others, anger at the coach, reflection): the human part first, then at most one question that opens something real; no lecture, no therapy-speak.
6. Same language as the user, natural register.
Prefer the reply that follows this constitution while still reading like a real friend. If equally good, answer TIE. Answer with exactly one token: A, B or TIE.`;
const JUDGE = JUDGE_KIND === "constitution" ? JUDGE_CONSTITUTION : JUDGE_GENERIC;
let win = 0, tie = 0, loss = 0, cost = 0;
const byTrack: Record<"A" | "B", { win: number; tie: number; loss: number }> = { A: { win: 0, tie: 0, loss: 0 }, B: { win: 0, tie: 0, loss: 0 } };
const details: string[] = [];
for (let i = 0; i < rows.length; i++) {
  const history = rows.slice(Math.max(0, i - 4), i).map((r) => `USER: ${r.user}\nCOACH: ${r.coach || "(silence)"}`).join("\n");
  const firstChunk = rows[i].coach.split(/(?<=[.。])\s+(?=[A-Z\u4e00-\u9fff])/)[0] ?? "";
  const codeLine = /^(Logged|Updated|Saved|Removed|Restored|Weekly limit set|All reminders|This week \(|No reminder|Right, they're|Those already|已記錄|已更新|已存|已移除|已還原|每週上限|所有提醒|本週)/.test(firstChunk) ? firstChunk : "";
  const ours = rows[i].coach || "(silence)";
  let theirs: string;
  if (refRows) {
    theirs = refRows[i]?.coach || "(silence)";
  } else {
    const ref = await ask(WRITER, `Conversation so far:\n${history}\n\nUSER: ${rows[i].user}\n${codeLine ? `The app's own confirmation line for this turn: "${codeLine}"\n` : ""}Write the reply.`);
    cost += ref.cost;
    theirs = codeLine && !ref.text.startsWith(codeLine) ? `${codeLine} ${ref.text}`.trim() : ref.text;
  }
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const track = trackOf(rows[i].user);
  if (norm(ours) === norm(theirs)) { tie++; byTrack[track].tie++; details.push(`[${i}] TIE  (identical) · USER: ${rows[i].user}\n      BOTH: ${ours}`); continue; }
  // Both presentation orders; a verdict only counts when the judge agrees with itself.
  const verdicts: Array<"ours" | "theirs" | "tie"> = [];
  for (const flip of [false, true]) {
    const A = flip ? theirs : ours, B = flip ? ours : theirs;
    const verdict = await ask(JUDGE, `Conversation so far:\n${history}\n\nUSER: ${rows[i].user}\n\nReply A: ${A}\n\nReply B: ${B}`, 40, JUDGE_MODEL);
    cost += verdict.cost;
    const v = verdict.text.toUpperCase().replace(/[^ABTIE]/g, "");
    if (v.startsWith("TIE") || v.startsWith("T")) verdicts.push("tie");
    else if ((v.startsWith("A") && !flip) || (v.startsWith("B") && flip)) verdicts.push("ours");
    else verdicts.push("theirs");
  }
  const consistent = verdicts[0] === verdicts[1] ? verdicts[0] : "tie";
  if (consistent === "tie") { tie++; byTrack[track].tie++; } else if (consistent === "ours") { win++; byTrack[track].win++; } else { loss++; byTrack[track].loss++; }
  details.push(`[${i}] ${consistent === "tie" ? "TIE " : consistent === "ours" ? "WIN " : "LOSS"} [${track}] (${verdicts.join("/")}) · USER: ${rows[i].user}\n      OURS: ${ours}\n      REF : ${theirs}`);
}
const pct = (t: { win: number; tie: number; loss: number }) => { const n = t.win + t.tie + t.loss; return n ? `${(100 * (t.win + t.tie) / n).toFixed(0)}% (${t.win}W ${t.tie}T ${t.loss}L of ${n})` : "n/a"; };
console.log(`ours vs ${refFile ? refFile : `${WRITER_MODEL} ${STYLE}-style reference`}, ${JUDGE_KIND} judge ${JUDGE_MODEL} · win ${win} · tie ${tie} · loss ${loss} · win-or-tie ${(100 * (win + tie) / rows.length).toFixed(0)}% · track A (coaching) ${pct(byTrack.A)} · track B (routine) ${pct(byTrack.B)} · cost $${cost.toFixed(3)}`);
for (const d of details) console.log(d);
await Deno.writeTextFile(file.replace(/\.json$/, `${refFile ? ".vs-grok" : `.pairwise-${STYLE}`}.${JUDGE_KIND}.txt`), details.join("\n") + `\n\nwin ${win} tie ${tie} loss ${loss}\ntrack A ${JSON.stringify(byTrack.A)}\ntrack B ${JSON.stringify(byTrack.B)}\n`);
