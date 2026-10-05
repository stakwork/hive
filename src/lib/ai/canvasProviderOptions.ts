/**
 * Canvas agent provider-options helper.
 *
 * `runCanvasAgent` needs to pass the model that will actually run the turn
 * into aieo's `getProviderOptions`, so Anthropic's newer 5.5-generation
 * models (which reject `thinking: { type: "disabled" }`) get aieo's "fast"
 * low-effort path instead. Kept in its own file (not `provider.ts`) because
 * several `runCanvasAgent-*` tests mock `aieo` with a factory that only
 * returns `getProviderOptions` — importing the rest of `provider.ts`'s
 * surface here would break those mocks.
 */

import { getProviderOptions, type Provider } from "aieo";

/**
 * Normalizes a model id for aieo's `anthropicRejectsDisabledThinking`/
 * `anthropicModelId` lookups only — turns a dot between two digits into a
 * dash (`claude-opus-5.5` -> `claude-opus-5-5`). The model id actually sent
 * to the API (via `getModel`) is never touched; this is purely so a
 * dotted id still resolves to the fast/low-effort path.
 */
function normalizeAnthropicModelId(modelId: string | undefined): string | undefined {
  if (!modelId) return modelId;
  return modelId.replace(/(\d)\.(\d)/g, "$1-$2");
}

/**
 * Builds the `providerOptions` payload for a canvas-agent `streamText` call.
 *
 * - `anthropic`: uses aieo's "fast" thinking speed so Sonnet 5.5, Opus 5.5
 *   and Fable get `{ effort: "low", cacheControl }` with no `thinking`
 *   field (the only shape those models accept), while every other Claude
 *   model keeps today's `thinking: { type: "disabled" }`.
 * - every other provider: unchanged — `getProviderOptions(provider)` with
 *   no thinking speed, so Google keeps its 24k thinking budget (passing
 *   "fast" would zero it) and OpenRouter keeps its usage flag.
 */
export function buildCanvasProviderOptions(provider: Provider, modelId?: string) {
  if (provider === "anthropic") {
    return getProviderOptions("anthropic", "fast", normalizeAnthropicModelId(modelId));
  }
  return getProviderOptions(provider);
}
