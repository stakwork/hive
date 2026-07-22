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
