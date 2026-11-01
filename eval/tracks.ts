// Scenario stratification for the voice benchmarks. Track A: high-stakes coaching turns
// (emotion, reflection, planning, pressure). Track B: routine logging, edits, settings,
// greetings, data questions, off-topic. Classified from the user's message only.
const TRACK_A = [
  /feel like (crap|shit|an idiot)|blew it|don'?t (even )?remember|can'?t sleep|really want a drink|pushing shots|annoying|做不到|撐不下去|好想喝|睡不著/i,
  /why do i|how'?s my week|how (did|is|was) (this|my) week|help me plan|what should i drink|dry days|drinking less|don'?t want to log/i,
];
export type Track = "A" | "B";
export function trackOf(userMessage: string): Track {
  return TRACK_A.some((re) => re.test(userMessage)) ? "A" : "B";
}
