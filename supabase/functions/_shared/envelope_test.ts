import { assertEquals } from "jsr:@std/assert@1";
import { validateEnvelope } from "./envelope.ts";

Deno.test("accepts a well-formed envelope", () => {
  const e = validateEnvelope({
    tool_calls: [{ name: "log_drink", args: { count: 2, beverage: "beer" } }],
    intent: "log",
    clarify: null,
    risk_flag: false,
  });
  assertEquals(e?.tool_calls[0].name, "log_drink");
  assertEquals(e?.intent, "log");
  assertEquals(e?.clarify, null);
});

Deno.test("rejects unknown tool names and bad shapes", () => {
  assertEquals(validateEnvelope({ tool_calls: [{ name: "drop_table", args: {} }], intent: "chat", risk_flag: false }), null);
  assertEquals(validateEnvelope({ tool_calls: "nope", intent: "chat", risk_flag: false }), null);
  assertEquals(validateEnvelope(null), null);
  assertEquals(validateEnvelope("{}"), null);
});

Deno.test("an unknown intent degrades to chat instead of failing the turn", () => {
  assertEquals(validateEnvelope({ tool_calls: [], intent: "banter", clarify: null, risk_flag: false })?.intent, "chat");
  assertEquals(validateEnvelope({ tool_calls: [], clarify: null, risk_flag: false })?.intent, "chat");
});

Deno.test("keeps clarify option ids as strings only", () => {
  const e = validateEnvelope({
    tool_calls: [],
    intent: "edit",
    clarify: { question: "Which one?", option_entry_ids: ["a", 7, "b"] },
    risk_flag: false,
  });
  assertEquals(e?.clarify?.option_entry_ids, ["a", "b"]);
});
