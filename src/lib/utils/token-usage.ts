/**
 * Shared utility for normalizing AI SDK `LanguageModelUsage` (or the
 * similar shape emitted in SSE `finish` events) into our canonical
 * `TokenUsage` shape.
 *
 * This is the SINGLE source of truth for the field-name mapping so
 * client (useStreamProcessor.ts) and server (api/ask/quick/route.ts)
 * never drift — both import from here.
 *
 * AI SDK v6 AND v7 both store cache counts in `inputTokenDetails`
 * (verified against ai@7.0.105's `LanguageModelUsage`, which still
 * declares the nested `inputTokenDetails` object):
 *   inputTokenDetails.cacheReadTokens  → cacheReadTokens
 *   inputTokenDetails.cacheWriteTokens → cacheWriteTokens
 *
 * One level down, the provider spec (`LanguageModelV2Usage` in
 * `@ai-sdk/provider`) is flat and only carries cache READS, as
 * `cachedInputTokens`. Anything that forwards provider-level usage
 * without re-nesting it lands on that field, so it is checked right
 * after the nested pair.
 *
 * Older SSE finish events / provider metadata may surface the same
 * counts under the legacy field names kept here as fallbacks:
 *   cachedInputTokens (provider-spec flat cache read)
 *   cacheReadInputTokens / cacheReadTokens
 *   cacheCreationInputTokens / cacheWriteTokens
 *   cache_read_input_tokens / cache_creation_input_tokens (raw Anthropic)
 *   usage.raw.* (ai@7 passthrough of the provider's own usage object)
 */

import type { TokenUsage } from "@/types/usage";

/**
 * The raw shape we receive from the AI SDK's `LanguageModelUsage` or
 * from the `finish` SSE event's `usage` field (which may carry legacy
 * field names from older SDK versions).
 */
export interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * AI SDK v6 AND v7 both nest cache counts here — `LanguageModelUsage`
   * in ai@7 still declares `inputTokenDetails.{noCacheTokens,
   * cacheReadTokens, cacheWriteTokens}`. This stays the highest-priority
   * source on both major versions.
   */
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
  /** Legacy flat field names (SDK < v6 or some SSE shapes). */
  cacheReadInputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationInputTokens?: number;
  cacheWriteTokens?: number;
  /**
   * Flat provider-level field: `LanguageModelV2Usage` in
   * `@ai-sdk/provider` exposes cache reads as `cachedInputTokens`, and
   * some SSE/finish payloads forward that un-nested value verbatim.
   */
  cachedInputTokens?: number;
  /** Raw Anthropic snake_case names, when a caller flattens them onto usage. */
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /**
   * ai@7 adds `raw` — the provider's own usage object, untouched. For
   * Anthropic that carries the snake_case cache counters, which is the
   * last place worth looking before giving up and reporting zero.
   */
  raw?: {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    [key: string]: unknown;
  };
}

/**
 * Optional Anthropic provider-metadata shape that some SDK versions
 * emit alongside `usage` in the finish event.
 */
export interface AnthropicProviderMeta {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Normalize any raw usage shape into our canonical `TokenUsage`.
 *
 * Priority for cache fields (highest → lowest):
 *   1. `inputTokenDetails.cacheReadTokens` / `.cacheWriteTokens`  (AI SDK v6)
 *   2. Flat `cacheReadInputTokens` / `cacheCreationInputTokens`   (legacy flat)
 *   3. Flat `cacheReadTokens` / `cacheWriteTokens`                (our own shape, round-trip)
 *   4. `providerMetadata.anthropic.*`                             (Anthropic sidecar)
 */
export function normalizeTokenUsage(
  raw: RawUsage | undefined | null,
  anthropicMeta?: AnthropicProviderMeta,
): TokenUsage {
  if (!raw) return {};

  const cacheRead =
    raw.inputTokenDetails?.cacheReadTokens ??
    raw.cachedInputTokens ??
    raw.cacheReadInputTokens ??
    raw.cacheReadTokens ??
    raw.cache_read_input_tokens ??
    anthropicMeta?.cacheReadInputTokens ??
    raw.raw?.cache_read_input_tokens;

  const cacheWrite =
    raw.inputTokenDetails?.cacheWriteTokens ??
    raw.cacheCreationInputTokens ??
    raw.cacheWriteTokens ??
    raw.cache_creation_input_tokens ??
    anthropicMeta?.cacheCreationInputTokens ??
    raw.raw?.cache_creation_input_tokens;

  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

/**
 * Small pure helper for rendering the cache read/write split in text.
 * Returns a string like "read: 1,234 · write: 567" or null when both
 * values are zero/undefined.
 */
export function formatCacheSplit(
  readTokens: number | undefined | null,
  writeTokens: number | undefined | null,
): string | null {
  const read = readTokens ?? 0;
  const write = writeTokens ?? 0;
  if (read === 0 && write === 0) return null;
  const parts: string[] = [];
  if (read > 0) parts.push(`read: ${formatTokens(read)}`);
  if (write > 0) parts.push(`write: ${formatTokens(write)}`);
  return parts.join(" · ");
}

/** Format a token count: ≤10k → localeString, >10k → "12.3k" */
function formatTokens(n: number): string {
  if (n > 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}
