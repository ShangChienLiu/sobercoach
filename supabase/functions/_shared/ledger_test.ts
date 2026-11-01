import { assertEquals } from "jsr:@std/assert@1";
import type { Db } from "./db.ts";
import { userSpendSince } from "./ledger.ts";

function fakeDb(result: { data?: unknown; error?: { message: string } | null }): Db {
  return { rpc: (_fn: string, _args: Record<string, unknown>) => Promise.resolve(result) } as unknown as Db;
}

Deno.test("userSpendSince sums the user's ledger through the RPC", async () => {
  assertEquals(await userSpendSince(fakeDb({ data: 0.1234, error: null }), "u1", "2026-11-01T00:00:00Z"), 0.1234);
  assertEquals(await userSpendSince(fakeDb({ data: [0.5], error: null }), "u1", "2026-11-01T00:00:00Z"), 0.5);
  assertEquals(await userSpendSince(fakeDb({ data: null, error: null }), "u1", "2026-11-01T00:00:00Z"), 0);
});

Deno.test("userSpendSince fails closed: an RPC error reads as over budget", async () => {
  assertEquals(await userSpendSince(fakeDb({ data: null, error: { message: "boom" } }), "u1", "2026-11-01T00:00:00Z"), Number.POSITIVE_INFINITY);
});
