/**
 * Pure helpers for the Graph Agent Chat surface.
 *
 * A chat thread has no table of its own — it IS a `sessionId`: the thread
 * list is `AgentRun` rows for the workspace grouped by session. Pure and
 * dependency-free so both the runs GET route and unit tests can share them.
 */

import type { GraphChatRunStatus, GraphChatThread } from "@/types/graph-chat";
import type { ConceptProposal } from "@/types/concept-proposals";

/** Row shape the grouping needs (subset of an AgentRun row). */
export interface ThreadSourceRun {
  sessionId: string | null;
  title: string;
  proposalsEnabled: boolean;
  status: GraphChatRunStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

/**
 * Group graph_chat runs into thread-list entries.
 *
 * Expects `runs` ordered oldest-first (createdAt asc). Per session:
 * title from the FIRST run (set from the opening prompt), proposals setting
 * and last status from the LATEST run, `updatedAt` from the latest update.
 * Rows without a sessionId are skipped. Result is newest-first.
 */
export function groupRunsIntoThreads(runs: ThreadSourceRun[]): GraphChatThread[] {
  const bySession = new Map<string, GraphChatThread>();
  for (const run of runs) {
    if (!run.sessionId) continue;
    const existing = bySession.get(run.sessionId);
    if (!existing) {
      bySession.set(run.sessionId, {
        sessionId: run.sessionId,
        title: run.title,
        proposalsEnabled: run.proposalsEnabled,
        lastStatus: run.status,
        updatedAt: toIso(run.updatedAt),
      });
      continue;
    }
    // Later run in the same session: keep the first title, refresh the rest.
    existing.proposalsEnabled = run.proposalsEnabled;
    existing.lastStatus = run.status;
    if (toIso(run.updatedAt) > existing.updatedAt) {
      existing.updatedAt = toIso(run.updatedAt);
    }
  }
  return [...bySession.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Proposals filed from a given repo/agent session — the correlation between
 * a chat thread and the proposals its runs filed (`sessionIds` per
 * stakgraph's PROPOSALS_API).
 */
export function filterProposalsForSession(proposals: ConceptProposal[], sessionId: string): ConceptProposal[] {
  return proposals.filter((p) => p.sessionIds?.includes(sessionId) ?? false);
}

/**
 * The thread's current Concept-reads reflection: the sidecar is
 * session-cumulative on the swarm (each terminal webhook delivers the merged
 * session state), so the LATEST run carrying one supersedes earlier
 * snapshots. Expects runs oldest-first, as the runs GET returns them.
 */
export function latestReflection<R extends { reflection?: unknown }>(runs: R[]): R["reflection"] | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].reflection) return runs[i].reflection;
  }
  return null;
}
