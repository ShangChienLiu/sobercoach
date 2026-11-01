// Cost, routing and safety ledger. Written with the service role because
// clients may only read their own rows.

import type { Db } from "./db.ts";
import { toNumber } from "./db.ts";

export type LedgerTier = "tier0_safety" | "tier0_fastpath" | "small" | "strong" | "fallback_fixed";

export interface LedgerEntry {
  user_id: string;
  role: "user" | "assistant";
  content: string;
  tier?: LedgerTier;
  model?: string;
  route_reason?: string;
  risk_flag?: boolean;
  tool_calls?: unknown;
  tokens_in?: number;
  tokens_cached?: number;
  tokens_out?: number;
  cost_usd?: number;
  latency_ms?: number;
}

export async function writeLedger(db: Db, entry: LedgerEntry): Promise<void> {
  const { error } = await db.from("messages").insert({
    ...entry,
    cost_usd: entry.cost_usd ?? 0,
    tokens_in: entry.tokens_in ?? 0,
    tokens_cached: entry.tokens_cached ?? 0,
    tokens_out: entry.tokens_out ?? 0,
    risk_flag: entry.risk_flag ?? false,
  });
  if (error) console.error("ledger write failed", error.message);
}

/**
 * Strong-model attempts by this user since the given instant. Counts the
 * route_reason marker so failed or invalid strong calls still count toward the cap.
 * Fails closed: an error reads as "capped".
 */
export async function strongCallsSince(db: Db, userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "assistant")
    .ilike("route_reason", "%strong_call%")
    .gte("created_at", sinceIso);
  if (error) {
    console.error("strongCallsSince failed", error.message);
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}

/**
 * Total spend across all users in the last 24 h, summed in SQL. Fails closed:
 * an error reads as "breaker tripped", which degrades chat to Tier-0 only.
 */
export async function globalSpendLast24h(db: Db): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db.rpc("ledger_spend_since", { p_since: since });
  if (error) {
    console.error("ledger_spend_since failed", error.message);
    return Number.POSITIVE_INFINITY;
  }
  return toNumber(Array.isArray(data) ? data[0] : data, 0);
}

export async function touchLastOpened(db: Db, userId: string): Promise<void> {
  await db.from("profiles").update({ last_opened_at: new Date().toISOString() }).eq("user_id", userId);
}

/**
 * This user's model spend since the given instant (all assistant rows, tool pass
 * plus writer plus dreaming), summed in SQL. Fails closed: an error reads as
 * "over budget", which drops the writer to the budget model rather than to silence.
 */
export async function userSpendSince(db: Db, userId: string, sinceIso: string): Promise<number> {
  const { data, error } = await db.rpc("ledger_user_spend_since", { p_user_id: userId, p_since: sinceIso });
  if (error) {
    console.error("ledger_user_spend_since failed", error.message);
    return Number.POSITIVE_INFINITY;
  }
  return toNumber(Array.isArray(data) ? data[0] : data, 0);
}
