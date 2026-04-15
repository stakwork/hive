/**
 * Scorer Pipeline
 *
 * Event-driven and cron-based pipeline for automatic scorer operations.
 */

import { db } from "@/lib/db";
import { computeFeatureMetrics } from "./metrics";
import { generateDigest } from "./digest";
import { analyzeSingleSession, analyzePatterns } from "./analysis";
import { cacheFeatureAgentStats } from "./agent-stats";

// ---------------------------------------------------------------------------
// Thresholds for automatic single-session analysis
// ---------------------------------------------------------------------------

const CORRECTION_THRESHOLD = 2;
const PLAN_ACCURACY_THRESHOLD = 50; // percent
const DURATION_MULTIPLIER = 3; // task > 3x workspace avg triggers analysis

// ---------------------------------------------------------------------------
// Event-driven: on feature completion
// ---------------------------------------------------------------------------

/**
 * Call this when a feature's last task reaches terminal state.
 * Checks if scorer is enabled for the workspace, then runs the pipeline.
 */
export async function onFeatureCompleted(featureId: string): Promise<void> {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      id: true,
      workspaceId: true,
      workspace: { select: { scorerEnabled: true } },
    },
  });

  if (!feature || !feature.workspace.scorerEnabled) return;

  try {
    // Step 1: Generate digest
    await generateDigest(featureId);

    // Step 2: Cache agent log stats (blob parsing)
    await cacheFeatureAgentStats(featureId);

    // Step 3: Check if single-session analysis is warranted
    const metrics = await computeFeatureMetrics(featureId);
    const shouldAnalyze = await shouldRunSingleAnalysis(
      metrics,
      feature.workspaceId
    );

    if (shouldAnalyze) {
      await analyzeSingleSession(featureId, feature.workspaceId);
    }
  } catch (error) {
    console.error(
      `Scorer pipeline failed for feature ${featureId}:`,
      error
    );
  }
}

/**
 * Check whether a feature is complete (all tasks in terminal state).
 * If so, trigger the scorer pipeline.
 */
export async function checkAndTriggerFeatureCompletion(
  featureId: string
): Promise<void> {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      id: true,
      tasks: {
        where: { deleted: false },
        select: { status: true },
      },
    },
  });

  if (!feature) return;

  const allTerminal = feature.tasks.every(
    (t) => t.status === "DONE" || t.status === "CANCELLED"
  );

  if (allTerminal && feature.tasks.length > 0) {
    await onFeatureCompleted(featureId);
  }
}

// ---------------------------------------------------------------------------
// Cron: pattern detection
// ---------------------------------------------------------------------------

/**
 * Run pattern detection across all enabled workspaces.
 * Call this from a cron job (e.g. daily).
 */
export async function runPatternDetectionCron(): Promise<void> {
  const workspaces = await db.workspace.findMany({
    where: { scorerEnabled: true, deleted: false },
    select: { id: true },
  });

  for (const ws of workspaces) {
    try {
      // Count digests created since last pattern detection
      const lastInsight = await db.scorerInsight.findFirst({
        where: { workspaceId: ws.id, mode: "pattern" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const newDigestsCount = await db.scorerDigest.count({
        where: {
          workspaceId: ws.id,
          ...(lastInsight
            ? { createdAt: { gt: lastInsight.createdAt } }
            : {}),
        },
      });

      // Only run if 10+ new digests
      if (newDigestsCount >= 10) {
        await analyzePatterns(ws.id);
      }
    } catch (error) {
      console.error(
        `Pattern detection failed for workspace ${ws.id}:`,
        error
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function shouldRunSingleAnalysis(
  metrics: Awaited<ReturnType<typeof computeFeatureMetrics>>,
  workspaceId: string
): Promise<boolean> {
  // Correction count > threshold
  if (metrics.totalCorrections > CORRECTION_THRESHOLD) return true;

  // CI failed on first attempt for any task
  if (metrics.tasks.some((t) => t.ciPassedFirstAttempt === false)) return true;

  // Plan accuracy below threshold
  if (
    (metrics.planPrecision !== null &&
      metrics.planPrecision < PLAN_ACCURACY_THRESHOLD) ||
    (metrics.planRecall !== null &&
      metrics.planRecall < PLAN_ACCURACY_THRESHOLD)
  ) {
    return true;
  }

  // Duration > 3x workspace average
  const avgDuration = await getWorkspaceAvgDuration(workspaceId);
  if (avgDuration) {
    const featureDuration = metrics.tasks.reduce(
      (sum, t) => sum + (t.durationMinutes || 0),
      0
    );
    if (featureDuration > avgDuration * DURATION_MULTIPLIER) return true;
  }

  return false;
}

async function getWorkspaceAvgDuration(
  workspaceId: string
): Promise<number | null> {
  const result = await db.task.aggregate({
    where: {
      feature: { workspaceId },
      deleted: false,
      workflowStartedAt: { not: null },
      workflowCompletedAt: { not: null },
    },
    _avg: {
      actualHours: true,
    },
  });

  // Fallback: compute from timestamps
  if (!result._avg.actualHours) {
    const tasks = await db.task.findMany({
      where: {
        feature: { workspaceId },
        deleted: false,
        workflowStartedAt: { not: null },
        workflowCompletedAt: { not: null },
      },
      select: { workflowStartedAt: true, workflowCompletedAt: true },
      take: 100,
    });

    if (tasks.length === 0) return null;

    const totalMinutes = tasks.reduce((sum, t) => {
      return (
        sum +
        (t.workflowCompletedAt!.getTime() -
          t.workflowStartedAt!.getTime()) /
          60000
      );
    }, 0);

    return totalMinutes / tasks.length;
  }

  return result._avg.actualHours * 60; // convert hours to minutes
}
