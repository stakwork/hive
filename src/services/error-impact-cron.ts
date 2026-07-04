/**
 * Error Impact Cron Service
 *
 * Iterates all workspaces with an active Jarvis/swarm config, finds ErrorIssue
 * rows that are unscored or stale (impactScoredAt older than STALENESS_HOURS),
 * fetches centrality data for each issue's referenced KG nodes, and persists
 * the computed impact score.
 *
 * Best-effort and non-blocking:
 *  - Each issue is wrapped in its own try/catch so one graph failure never
 *    aborts the batch.
 *  - A workspace-level failure (e.g. bad Jarvis config) skips that workspace
 *    without stopping others.
 *  - Never throws from the top-level export — callers always get a summary.
 */

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getReferencedNodeCentrality } from "@/services/swarm/api/nodes";
import { computeImpactScore } from "@/services/error-impact";
import { Prisma } from "@prisma/client";

const LOG_PREFIX = "[error-impact]";

/** Issues with no score, or scored more than this many hours ago, are rescored. */
const STALENESS_HOURS = 24;

/** Max issues to process per workspace per cron run (avoid runaway). */
const ISSUES_PER_WORKSPACE = 100;

/** Per-issue Jarvis timeout — keep tight so stalled swarms don't eat the budget. */
const JARVIS_TIMEOUT_MS = 8_000;

export interface ErrorImpactCronResult {
  success: boolean;
  workspacesProcessed: number;
  issuesScored: number;
  issuesSkipped: number;
  errors: Array<{ workspaceId: string; issueId?: string; error: string }>;
  timestamp: Date;
}

/**
 * Run the error-impact scoring pass across all eligible workspaces/issues.
 * Never throws — always returns a summary result.
 */
export async function runErrorImpactCron(): Promise<ErrorImpactCronResult> {
  const timestamp = new Date();
  const result: ErrorImpactCronResult = {
    success: true,
    workspacesProcessed: 0,
    issuesScored: 0,
    issuesSkipped: 0,
    errors: [],
    timestamp,
  };

  console.info(`${LOG_PREFIX} cron starting`, { timestamp: timestamp.toISOString() });

  // Find all workspaces that have an active swarm (required for Jarvis access).
  // Scope strictly by workspaceId — never mix nodes/config between workspaces.
  let workspaces: Array<{ id: string; name: string }>;
  try {
    workspaces = await db.workspace.findMany({
      where: {
        deleted: false,
        swarm: { isNot: null },
      },
      select: { id: true, name: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} failed to fetch workspaces (aborting cron)`, { error: msg });
    result.success = false;
    result.errors.push({ workspaceId: "global", error: msg });
    return result;
  }

  console.info(`${LOG_PREFIX} found ${workspaces.length} eligible workspace(s)`);

  const staleThreshold = new Date(Date.now() - STALENESS_HOURS * 3600 * 1000);

  for (const workspace of workspaces) {
    try {
      await processWorkspace(workspace, staleThreshold, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} workspace processing failed (skipping)`, {
        workspaceId: workspace.id,
        error: msg,
      });
      result.success = false;
      result.errors.push({ workspaceId: workspace.id, error: msg });
    }
    result.workspacesProcessed++;
  }

  console.info(`${LOG_PREFIX} cron complete`, {
    workspacesProcessed: result.workspacesProcessed,
    issuesScored: result.issuesScored,
    issuesSkipped: result.issuesSkipped,
    errorCount: result.errors.length,
  });

  return result;
}

async function processWorkspace(
  workspace: { id: string; name: string },
  staleThreshold: Date,
  result: ErrorImpactCronResult,
): Promise<void> {
  const jarvisConfig = await getJarvisConfigForWorkspace(workspace.id);
  if (!jarvisConfig) {
    console.info(`${LOG_PREFIX} skipping workspace — no Jarvis config`, {
      workspaceId: workspace.id,
    });
    return;
  }

  // Fetch issues needing (re)scoring for this workspace only.
  const issues = await db.errorIssue.findMany({
    where: {
      workspaceId: workspace.id,
      kgRefId: { not: null }, // only issues with a KG node can be scored
      OR: [
        { impactScoredAt: null },
        { impactScoredAt: { lt: staleThreshold } },
      ],
    },
    select: {
      id: true,
      workspaceId: true,
      kgRefId: true,
    },
    take: ISSUES_PER_WORKSPACE,
    orderBy: { impactScoredAt: "asc" }, // oldest/unscored first
  });

  if (issues.length === 0) {
    console.info(`${LOG_PREFIX} no issues need scoring`, { workspaceId: workspace.id });
    return;
  }

  console.info(`${LOG_PREFIX} scoring ${issues.length} issue(s)`, { workspaceId: workspace.id });

  for (const issue of issues) {
    // Per-issue isolation — one graph failure must never abort the batch.
    try {
      if (!issue.kgRefId) {
        result.issuesSkipped++;
        continue;
      }

      const centralityResult = await getReferencedNodeCentrality(
        jarvisConfig,
        issue.kgRefId,
        { timeoutMs: JARVIS_TIMEOUT_MS },
      );

      if (!centralityResult.ok) {
        console.warn(`${LOG_PREFIX} centrality fetch failed (skipping issue)`, {
          workspaceId: workspace.id,
          issueId: issue.id,
          error: centralityResult.error,
        });
        result.issuesSkipped++;
        result.errors.push({
          workspaceId: workspace.id,
          issueId: issue.id,
          error: centralityResult.error ?? "centrality fetch failed",
        });
        continue;
      }

      const scored = computeImpactScore(centralityResult.nodes);

      await db.errorIssue.update({
        where: { id: issue.id },
        data: {
          impactScore: scored?.score ?? null,
          impactScoredAt: new Date(),
          impactMeta: scored?.meta
            ? (scored.meta as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });

      console.info(`${LOG_PREFIX} scored issue`, {
        workspaceId: workspace.id,
        issueId: issue.id,
        score: scored?.score ?? null,
        nodeCount: centralityResult.nodes.length,
      });

      result.issuesScored++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} issue scoring failed (skipping)`, {
        workspaceId: workspace.id,
        issueId: issue.id,
        error: msg,
      });
      result.success = false;
      result.errors.push({ workspaceId: workspace.id, issueId: issue.id, error: msg });
    }
  }
}
