/**
 * Jamie's per-chat A/B arm.
 *
 * - `"full"` — the complete system prompt and per-workspace toolset.
 * - `"concept"` — a tiny system prompt and a short, global toolset
 *   (`conceptModeTools.ts`).
 *
 * Stored on `SharedConversation.mode` when the chat is created and never
 * changed; every later turn (user, planner wake, strut wake) reads it from
 * the row. Anything that isn't exactly `"concept"` reads as `"full"`, so an
 * unknown or missing value can never switch a chat into the experiment.
 */
export type CanvasAgentMode = "full" | "concept";

export const DEFAULT_CANVAS_AGENT_MODE: CanvasAgentMode = "full";

export function parseCanvasAgentMode(value: unknown): CanvasAgentMode {
  return value === "concept" ? "concept" : DEFAULT_CANVAS_AGENT_MODE;
}
