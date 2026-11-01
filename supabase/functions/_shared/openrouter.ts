// OpenRouter client. One key, ZDR enforced per request, pinned providers,
// cross-vendor fallback, strict JSON schema output, explicit cache breakpoint.

import { estimateCostUsd, type Usage } from "./pricing.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ContentPart {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface JsonSchemaFormat {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

export interface CallOptions {
  models: string[]; // primary first, then fallbacks
  messages: ChatMessage[];
  schema: JsonSchemaFormat;
  maxTokens: number;
  temperature?: number;
  sessionId: string; // user_id, keeps a user on one upstream
  providerOrder?: string[]; // pinned ZDR endpoints for the primary model
  timeoutMs?: number;
}

export interface CallResult<T> {
  parsed: T;
  raw: string;
  model: string;
  provider: string | null;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
}

export class OpenRouterError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterEnv {
  apiKey: string;
  appUrl?: string;
  appTitle?: string;
  fetchImpl?: typeof fetch;
}

export async function callStructured<T>(env: OpenRouterEnv, opts: CallOptions): Promise<CallResult<T>> {
  if (!env.apiKey) throw new OpenRouterError("OPENROUTER_API_KEY not configured");
  const [primary, ...fallbacks] = opts.models;
  const body = {
    model: primary,
    models: fallbacks.length ? opts.models : undefined,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    response_format: { type: "json_schema", json_schema: opts.schema },
    usage: { include: true },
    user: opts.sessionId,
    session_id: opts.sessionId,
    provider: {
      zdr: true,
      data_collection: "deny",
      require_parameters: true,
      ignore: ["DeepSeek"],
      ...(opts.providerOrder?.length ? { order: opts.providerOrder } : {}),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  const started = Date.now();
  let res: Response;
  try {
    res = await (env.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.appUrl ?? "https://sobercoach.app",
        "X-Title": env.appTitle ?? "SoberCoach",
      },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    const msg = error instanceof Error ? error.message : "network error";
    throw new OpenRouterError(`OpenRouter request failed: ${msg}`);
  }
  clearTimeout(timer);
  const latencyMs = Date.now() - started;
  const text = await res.text();
  if (!res.ok) throw new OpenRouterError(`OpenRouter HTTP ${res.status}`, res.status, text.slice(0, 500));

  let json: OpenRouterResponse;
  try {
    json = JSON.parse(text) as OpenRouterResponse;
  } catch {
    throw new OpenRouterError("OpenRouter returned non-JSON body", res.status, text.slice(0, 200));
  }
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new OpenRouterError(`OpenRouter response had no content (finish_reason=${choice?.finish_reason ?? "?"})`, res.status, text.slice(0, 500));
  }
  if (choice?.finish_reason === "length") {
    throw new OpenRouterError("Model output truncated (finish_reason=length)", res.status, content.slice(0, 200));
  }
  const parsed = parseJsonLoose<T>(content);
  const usage: Usage = {
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    cached_tokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
  };
  const model = json.model ?? primary;
  const costUsd = typeof json.usage?.cost === "number" ? json.usage.cost : estimateCostUsd(model, usage);
  return { parsed, raw: content, model, provider: json.provider ?? null, usage, costUsd, latencyMs };
}

interface OpenRouterResponse {
  model?: string;
  provider?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Tolerates a ```json fence around the object; otherwise strict JSON. */
export function parseJsonLoose<T>(content: string): T {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new OpenRouterError("Model output was not valid JSON", undefined, trimmed.slice(0, 200));
  }
}

export interface PlainTextOptions {
  models: string[];
  /** "off" for models that allow it (Haiku); "low" asks for minimal effort (Sonnet 5.5 ZDR accepts it, 0 reasoning tokens); "default" leaves the endpoint's own setting. */
  reasoning?: "off" | "default" | "low";
  system: string;
  user: string;
  maxTokens: number;
  sessionId: string;
  timeoutMs?: number;
}

export interface PlainTextResult {
  text: string;
  finishReason: string | null;
  model: string;
  provider: string | null;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
}

/** Same gateway settings as callStructured, but free text (no JSON schema). */
export async function callPlainText(env: OpenRouterEnv, opts: PlainTextOptions): Promise<PlainTextResult> {
  if (!env.apiKey) throw new OpenRouterError("OPENROUTER_API_KEY not configured");
  const [primary, ...fallbacks] = opts.models;
  const body = {
    model: primary,
    models: fallbacks.length ? opts.models : undefined,
    messages: [
      { role: "system", content: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens,
    // Hidden reasoning must not eat a short line. Haiku allows it off; Sonnet 5.5 ZDR endpoints only allow a minimum.
    ...(opts.reasoning === "default" ? {} : opts.reasoning === "low" ? { reasoning: { effort: "low" } } : { reasoning: { enabled: false } }),
    usage: { include: true },
    user: opts.sessionId,
    session_id: opts.sessionId,
    provider: { zdr: true, data_collection: "deny", ignore: ["DeepSeek"] },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const started = Date.now();
  let res: Response;
  try {
    res = await (env.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${env.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": env.appUrl ?? "https://sobercoach.app", "X-Title": env.appTitle ?? "SoberCoach" },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    throw new OpenRouterError(`OpenRouter request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  clearTimeout(timer);
  const latencyMs = Date.now() - started;
  const text = await res.text();
  if (!res.ok) throw new OpenRouterError(`OpenRouter HTTP ${res.status}`, res.status, text.slice(0, 500));
  const json = JSON.parse(text) as OpenRouterResponse;
  const content = json.choices?.[0]?.message?.content;
  const usage: Usage = {
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    cached_tokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
  };
  const model = json.model ?? primary;
  return { text: typeof content === "string" ? content : "", finishReason: json.choices?.[0]?.finish_reason ?? null, model, provider: json.provider ?? null, usage, costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : estimateCostUsd(model, usage), latencyMs };
}
