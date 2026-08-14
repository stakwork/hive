/**
 * Graph Agent Chat types — the contract of the
 * /api/workspaces/[slug]/graph/agent[/runs] routes.
 *
 * Client-safe (no @prisma/client import): `GraphChatRunStatus` mirrors the
 * `AgentRunStatus` enum as a string union. Graph runs terminal at
 * DELIVERED_WEBHOOK / FAILED; DELIVERED_INLINE is unused by this flow.
 */

import type { SessionReflection } from "@/types/agent-logs";

export type GraphChatRunStatus = "PENDING" | "DELIVERED_INLINE" | "DELIVERED_WEBHOOK" | "FAILED";

/** One prompt/result pair in a thread (a single AgentRun row). */
export interface GraphChatRun {
  id: string;
  prompt: string | null;
  result: string | null;
  status: GraphChatRunStatus;
  error: string | null;
  proposalsEnabled: boolean;
  /**
   * stakgraph SessionReflection sidecar from the terminal webhook — which
   * gitree Concepts the session read (always recorded; ranked only when the
   * dispatch opts into the reflect pass, which graph chat does not).
   * Session-cumulative: the latest run's snapshot supersedes earlier ones.
   */
  reflection?: SessionReflection | null;
  createdAt: string;
}

/** Thread-list entry — a thread IS a sessionId (no dedicated table). */
export interface GraphChatThread {
  sessionId: string;
  /** First run's title (derived from the opening prompt's first line). */
  title: string;
  /** Per-thread proposals setting, derived from the latest run's snapshot. */
  proposalsEnabled: boolean;
  lastStatus: GraphChatRunStatus;
  updatedAt: string;
}

/** Response of GET /api/workspaces/[slug]/graph/agent/runs?sessionId= */
export interface GraphChatRunsResponse {
  runs: GraphChatRun[];
}

/** Response of GET /api/workspaces/[slug]/graph/agent/runs (no sessionId) */
export interface GraphChatThreadsResponse {
  threads: GraphChatThread[];
}

/** Response of POST /api/workspaces/[slug]/graph/agent */
export interface GraphChatDispatchResponse {
  runId: string;
  sessionId: string;
}
