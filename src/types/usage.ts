/**
 * Canonical per-turn LLM token usage shape, shared across:
 *   - src/types/streaming.ts (BaseStreamingMessage + FinishEvent)
 *   - src/lib/utils/agent-log-stats.ts (ParsedMessage)
 *   - src/app/org/[githubLogin]/_state/canvasChatStore.ts (CanvasChatMessage)
 *   - src/components/agent-logs/TurnTokenUsage.tsx (via agent-log-stats import)
 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/** Field-wise sum. Here, not in a service, so the client can import it. */
export function addUsage(
  a: TokenUsage | undefined,
  b: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: TokenUsage = { ...a };
  for (const key of USAGE_KEYS) {
    const add = b[key];
    if (typeof add === "number") out[key] = (out[key] ?? 0) + add;
  }
  return out;
}
