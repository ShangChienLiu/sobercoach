// Supabase clients and row types. Tool writes use the caller's JWT so RLS
// scopes every row to auth.uid(); the ledger and reminder_log use the
// service role because clients may only read them.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export type Db = SupabaseClient;

export interface Profile {
  user_id: string;
  display_name: string | null;
  timezone: string;
  rollover_hour: number;
  goal_type: "moderation" | "abstinence";
  weekly_limit: number;
  quiet_start: number;
  quiet_end: number;
  is_test: boolean;
  age_confirmed: boolean;
  apns_token: string | null;
  last_opened_at: string | null;
  /** Dreaming-pass summary the writer reads every turn; may be absent on rows older than the migration. */
  soul_profile?: string | null;
  soul_profile_updated_at?: string | null;
  turns_since_dream?: number | null;
  /** Guideline layer (US basis): sex for NIAAA lines, AUDIT-C from onboarding. */
  sex_for_guidelines?: "male" | "female" | null;
  audit_c_score?: number | null;
  audit_c_at?: string | null;
}

export interface DrinkEntry {
  id: string;
  user_id: string;
  occurred_at: string;
  service_date: string;
  beverage: string;
  count: number;
  volume_ml: number | null;
  abv: number | null;
  std_drinks_exact: number | null;
  std_drinks_nominal: number;
  status: "active" | "undone" | "confirmed_dry";
  version: number;
  previous_snapshot: Record<string, unknown> | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  timezone: string;
  status: "active" | "cancelled";
  kind?: "drinking_social" | "general_reminder" | null;
}

export interface ConsentRow {
  category: "event_prep" | "morning_after" | "missed_log";
  enabled: boolean;
}

export interface MessageRow {
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface DailyTotal {
  service_date: string;
  drinks_count: number;
  std_drinks: number;
  has_nominal: boolean;
  confirmed_dry: boolean;
  active_entries: number;
}

export function env(key: string): string | undefined {
  const v = Deno.env.get(key);
  return v === "" ? undefined : v;
}

export function requireEnv(key: string): string {
  const v = env(key);
  if (!v) throw new Error(`${key} not configured`);
  return v;
}

/** Client acting as the calling user. Every query is RLS-scoped. */
export function userClient(authHeader: string): Db {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client for ledger writes and the scheduler. Never exposed to the app. */
export function serviceClient(): Db {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function currentUserId(db: Db): Promise<string | null> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extraHeaders },
  });
}

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}
