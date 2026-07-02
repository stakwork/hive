/**
 * The exhaustive registry of `agentName` values any LLM call site in
 * Hive may emit.
 *
 * Extracted into this thin, dependency-free file so UI / client-side
 * modules can import the names and type without pulling in the
 * server-only reconciler chain (ioredis, etc.) that lives in
 * `orchestrator.ts`.
 *
 * `orchestrator.ts` re-exports from here for backward compatibility.
 */
export const BIFROST_AGENT_NAMES = [
  // Chat surfaces (PR #4078)
  "repo-agent",
  "chat-agent",
  "canvas-agent",
  "diagram-agent",
  "logs-agent",
  // Workflow / agent-session surfaces (PR #4079)
  "plan-agent",
  "coding-agent",
  "test-agent",
  "build-agent",
  "browser-agent",
] as const;

export type BifrostAgentName = (typeof BIFROST_AGENT_NAMES)[number];
