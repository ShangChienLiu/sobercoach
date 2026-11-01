// Structural validation of the model's JSON envelope. Strict schema mode does
// the heavy lifting upstream; this guards against providers that ignore it.

import { type Envelope, type Intent, INTENTS, TOOL_NAMES, type ToolCall } from "./prompt.ts";

/** Light structural validation; strict schema mode does the heavy lifting upstream. */
export function validateEnvelope(raw: unknown): Envelope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.tool_calls) || typeof o.risk_flag !== "boolean") return null;
  const calls: ToolCall[] = [];
  for (const c of o.tool_calls) {
    if (!c || typeof c !== "object") return null;
    const cc = c as Record<string, unknown>;
    if (typeof cc.name !== "string" || !(TOOL_NAMES as ReadonlyArray<string>).includes(cc.name)) return null;
    if (!cc.args || typeof cc.args !== "object") return null;
    calls.push({ name: cc.name as ToolCall["name"], args: cc.args as Record<string, unknown> });
  }
  let clarify: Envelope["clarify"] = null;
  if (o.clarify && typeof o.clarify === "object") {
    const cl = o.clarify as Record<string, unknown>;
    if (typeof cl.question === "string" && Array.isArray(cl.option_entry_ids)) {
      clarify = { question: cl.question, option_entry_ids: cl.option_entry_ids.filter((x): x is string => typeof x === "string") };
    }
  }
  // An unknown or missing label degrades to "chat" rather than failing the turn; the router treats it as routine.
  const intent: Intent = typeof o.intent === "string" && (INTENTS as ReadonlyArray<string>).includes(o.intent) ? o.intent as Intent : "chat";
  return { tool_calls: calls, intent, clarify, risk_flag: o.risk_flag };
}
