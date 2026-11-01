// Model routes and list prices. OpenRouter's reported usage.cost is ground
// truth when present; this table is the fallback and the budget baseline.
// Confirm every price on the vendor's own pricing page before submission.

export interface ModelPrice {
  inputPerM: number; // USD per 1M input tokens
  cachedInputPerM: number; // USD per 1M cached input tokens
  outputPerM: number; // USD per 1M output tokens
}

export type Tier = "small" | "strong" | "strong_fallback";

export interface ModelRoute {
  id: string;
  tier: Tier;
  price: ModelPrice;
}

const DEFAULT_SMALL = "anthropic/claude-haiku-5.5";
const DEFAULT_STRONG = "google/gemini-3.5-flash-lite";
const DEFAULT_STRONG_FALLBACK = "anthropic/claude-sonnet-5.5";

// List prices read from OpenRouter /api/v1/models on 2026-10-31 (USD per 1M tokens).
// Cached-input prices are not exposed there; 10% of input is assumed until measured.
export const PRICE_TABLE: Record<string, ModelPrice> = {
  "anthropic/claude-haiku-5.5": { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 },
  "anthropic/claude-sonnet-5.5": { inputPerM: 2.0, cachedInputPerM: 0.2, outputPerM: 10.0 },
  "google/gemini-3.5-flash-lite": { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 },
  "google/gemini-3.7-flash": { inputPerM: 0.75, cachedInputPerM: 0.075, outputPerM: 3.75 },
  "openai/gpt-6-luna": { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 },
  "openai/gpt-6.1-sol": { inputPerM: 2.0, cachedInputPerM: 0.2, outputPerM: 10.0 },
};

const FALLBACK_PRICE: ModelPrice = { inputPerM: 1.0, cachedInputPerM: 0.1, outputPerM: 5.0 };

export function priceFor(modelId: string): ModelPrice {
  return PRICE_TABLE[modelId] ?? FALLBACK_PRICE;
}

export function modelForTier(tier: Tier, env: (k: string) => string | undefined): ModelRoute {
  const id = tier === "small"
    ? env("SMALL_MODEL") ?? DEFAULT_SMALL
    : tier === "strong"
    ? env("STRONG_MODEL") ?? DEFAULT_STRONG
    : env("STRONG_FALLBACK_MODEL") ?? DEFAULT_STRONG_FALLBACK;
  return { id, tier, price: priceFor(id) };
}

export interface Usage {
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
}

export function estimateCostUsd(modelId: string, usage: Usage): number {
  const p = priceFor(modelId);
  const uncached = Math.max(0, usage.prompt_tokens - usage.cached_tokens);
  const usd = (uncached * p.inputPerM + usage.cached_tokens * p.cachedInputPerM + usage.completion_tokens * p.outputPerM) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** OpenRouter adds a 5.5% fee on credit purchases; applied for budgeting. */
export const OPENROUTER_FEE = 0.055;
