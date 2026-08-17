/**
 * Shared utility for normalizing AI SDK `LanguageModelUsage` (or the
 * similar shape emitted in SSE `finish` events) into our canonical
 * `TokenUsage` shape.
 *
 * This is the SINGLE source of truth for the field-name mapping so
 * client (useStreamProcessor.ts) and server (api/ask/quick/route.ts)
 * never drift — both import from here.
 *
 * AI SDK v6 stores cache counts in `inputTokenDetails`:
 *   inputTokenDetails.cacheReadTokens  → cacheReadTokens
 *   inputTokenDetails.cacheWriteTokens → cacheWriteTokens
 *
 * Older SSE finish events / provider metadata may surface the same
 * counts under the legacy field names kept here as fallbacks:
 *   cacheReadInputTokens / cacheReadTokens
 *   cacheCreationInputTokens / cacheWriteTokens
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
  /** AI SDK v6 nests cache counts here. */
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
    raw.cacheReadInputTokens ??
    raw.cacheReadTokens ??
    anthropicMeta?.cacheReadInputTokens;

  const cacheWrite =
    raw.inputTokenDetails?.cacheWriteTokens ??
    raw.cacheCreationInputTokens ??
    raw.cacheWriteTokens ??
    anthropicMeta?.cacheCreationInputTokens;

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
