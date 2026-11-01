import { assert, assertEquals } from "jsr:@std/assert@1";
import { ENVELOPE_SCHEMA } from "./prompt.ts";
import { normalizeArgs } from "./tools_exec.ts";

function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countUnions(x), 0);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    let n = 0;
    if (Array.isArray(o.anyOf) || Array.isArray(o.oneOf) || Array.isArray(o.type)) n += 1;
    for (const v of Object.values(o)) n += countUnions(v);
    return n;
  }
  return 0;
}

Deno.test("envelope schema stays within Anthropic's 16 union-typed parameter limit", () => {
  const n = countUnions(ENVELOPE_SCHEMA.schema);
  assert(n <= 16, `schema has ${n} union-typed parameters`);
});

Deno.test("shared slots map to per-tool names", () => {
  assertEquals(normalizeArgs({ text: "Party", flag: false }).title, "Party");
  assertEquals(normalizeArgs({ text: "Party", flag: false }).enabled, false);
  assertEquals(normalizeArgs({ title: "X", text: "Y" }).title, "X");
});
