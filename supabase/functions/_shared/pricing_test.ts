import { assertEquals } from "jsr:@std/assert@1";
import { modelChainFor, modelForTier } from "./pricing.ts";

const none = (_k: string) => undefined;

Deno.test("defaults: Haiku decides, Sonnet is the strong decision model, Haiku is its fallback", () => {
  assertEquals(modelForTier("small", none).id, "anthropic/claude-haiku-5.5");
  assertEquals(modelForTier("strong", none).id, "anthropic/claude-sonnet-5.5");
  assertEquals(modelForTier("strong_fallback", none).id, "anthropic/claude-haiku-5.5");
});

Deno.test("model chains fall from small to strong and from strong to its fallback, without repeating a model", () => {
  assertEquals(modelChainFor("small", none), ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5"]);
  assertEquals(modelChainFor("strong", none), ["anthropic/claude-sonnet-5.5", "anthropic/claude-haiku-5.5"]);
  const same = (k: string) => (k === "STRONG_FALLBACK_MODEL" ? "anthropic/claude-sonnet-5.5" : undefined);
  assertEquals(modelChainFor("strong", same), ["anthropic/claude-sonnet-5.5"]);
});
