/**
 * Error impact cron service.
 *
 * Iterates workspaces that have an active Jarvis/swarm config, selects
 * ErrorIssue rows that need (re)scoring (no impactScoredAt, or scored more
 * than STALENESS_HOURS ago), fetches centrality of their referenced KG nodes,
 * computes the impact score, and persists the result.
 *
 * Each issue is wrapped in its own try/catch so one graph failure never aborts
 * the batch. Follows the janitor-cron pattern exactly.
 */

import { db } from "@/lib/db";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getReferencedNodeCentrality } from "@/services/swarm/api/nodes";
import { computeImpactScore } from "@/services/error-impact";
import { Prisma } from "@prisma/client";

const STALENESS_HOURS = 24;
const BATCH_SIZE = 50; // issues per workspace per run

export interface ErrorImpactCronResult {
  success: boolean;
  workspacesProcessed: number;
  issuesScored: number;
  issuesSkipped: number;
  errors: Array<{ workspaceId: string; issueId: string; error: string }>;
  timestamp: Date;
}

export async function runErrorImpactCron(): Promise<ErrorImpactCronResult> {
  const timestamp = new Date();
  let workspacesProcessed = 0;
  let issuesScored = 0;
  let issuesSkipped = 0;
  const errors: ErrorImpactCronResult["errors"] = [];

  console.info("[error-impact] cron started");

  // Fetch all workspaces that have at least one ErrorIssue with a kgRefId
  // (meaning they had successful KG projection at ingest time) and a Swarm.
  const workspaces = await db.workspace.findMany({
    where: {
      deleted: false,
      swarm: { isNot: null },
      errorIssues: { some: { kgRefId: { not: null } } },
    },
    select: { id: true },
  });

  console.info(`[error-impact] found ${workspaces.length} workspace(s) to process`);

  for (const workspace of workspaces) {
    const jarvisConfig = await getJarvisConfigForWorkspace(workspace.id);
    if (!jarvisConfig) {
      console.info("[error-impact] skipping workspace (no jarvis config)", { workspaceId: workspace.id });
      continue;
    }

    // Select issues needing (re)scoring: those with a kgRefId but either
    // never scored (impactScoredAt null) or scored before the staleness window.
    const staleThreshold = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000);
    const issues = await db.errorIssue.findMany({
      where: {
        workspaceId: workspace.id,
        kgRefId: { not: null },
        OR: [
          { impactScoredAt: null },
          { impactScoredAt: { lt: staleThreshold } },
        ],
      },
      select: { id: true, kgRefId: true },
      take: BATCH_SIZE,
      orderBy: { lastSeenAt: "desc" },
    });

    workspacesProcessed++;
    console.info(`[error-impact] workspace ${workspace.id}: ${issues.length} issue(s) to score`);

    for (const issue of issues) {
      try {
        if (!issue.kgRefId) {
          issuesSkipped++;
          continue;
        }

        const centralityResult = await getReferencedNodeCentrality(jarvisConfig, issue.kgRefId);

        if (!centralityResult.ok) {
          console.warn("[error-impact] graph read failed (skipping issue)", {
            issueId: issue.id,
            error: centralityResult.error,
          });
          issuesSkipped++;
          continue;
        }

        const scored = computeImpactScore(centralityResult.nodes);

        await db.errorIssue.update({
          where: { id: issue.id },
          data: {
            impactScore: scored?.score ?? null,
            impactScoredAt: new Date(),
            impactMeta: scored?.meta ? (scored.meta as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          },
        });

        console.info("[error-impact] scored issue", {
          issueId: issue.id,
          score: scored?.score ?? null,
          nodeCount: scored?.meta.nodeCount ?? 0,
          topNode: scored?.meta.topNodeName ?? null,
        });

        issuesScored++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn("[error-impact] failed to score issue (non-fatal)", {
          issueId: issue.id,
          error: errMsg,
        });
        errors.push({ workspaceId: workspace.id, issueId: issue.id, error: errMsg });
      }
    }
  }

  const success = errors.length === 0;
  console.info(`[error-impact] cron complete — workspaces: ${workspacesProcessed}, scored: ${issuesScored}, skipped: ${issuesSkipped}, errors: ${errors.length}`);

  return { success, workspacesProcessed, issuesScored, issuesSkipped, errors, timestamp };
}
