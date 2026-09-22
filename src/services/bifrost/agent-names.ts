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
  // Workflow-editor planning — split out from `plan-agent` so the
  // workflow-editor planning surface gets its own catalog identity,
  // prompts, and budget rather than sharing the code-planning agent's.
  "wfe-plan-agent",
  "coding-agent",
  "test-agent",
  "build-agent",
  "browser-agent",
  "security-review-agent",
  // Strut (plans/mothership-cost-control.md §4). `strut-agent` is the
  // ROOT of every strut lineage: the standing invocation hive mints per
  // user names it, and strut attenuates per run / per step below it
  // (`<workflow>.<step>` names are added by strut, never listed here).
  // `strut-assistant` is the leaf a strut chat turn is billed as.
  "strut-agent",
  "strut-assistant",
] as const;

export type BifrostAgentName = (typeof BIFROST_AGENT_NAMES)[number];
