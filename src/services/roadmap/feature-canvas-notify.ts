/**
 * Canvas-refresh fan-out for feature/task mutations.
 *
 * When a Feature's `status` or any of its child Tasks' `workflowStatus`
 * change, the org canvas's milestone card needs to re-project. The
 * affected canvases are:
 *
 *   - root (`""`)                            — initiative card progress rollup
 *   - `initiative:<initiativeId>`            — milestone timeline card
 *   - `milestone:<milestoneId>`              — feature/task sub-canvas
 *
 * Why every caller, every time:
 *   - The milestone card's `customData.progress` fraction changes
 *     when any child task transitions DONE.
 *   - The milestone card's `customData.agentCount` (PENDING +
 *     IN_PROGRESS task count) changes whenever a task enters or
 *     leaves either of those workflow states — possibly without the
 *     feature's own status flipping.
 *   - The milestone sub-canvas projects task cards directly, so any
 *     task mutation (status, workflowStatus, title, assignee) is a
 *     visible state change there.
 *
 * This helper is the single place that fans out for these cases.
 * Callers invoke it alongside (typically immediately after) their
 * existing status-sync calls. Keeping it OUT of
 * `updateFeatureStatusFromTasks` means that function stays a single-
 * responsibility "compute and persist feature status" routine, and
 * the canvas concern stays scoped to canvas-aware code paths.
 *
 * Fire-and-forget by design: a Pusher hiccup must not fail the
 * task/feature mutation that triggered it. Errors are caught and
 * logged.
 */
import { db } from "@/lib/db";
import { notifyCanvasesUpdatedByLogin } from "@/lib/canvas";

/**
 * Resolve the affected canvas refs (and the org's githubLogin) for a
 * feature change. Returns `null` when the feature isn't linked to a
 * milestone — there's nothing org-canvas to refresh, so the caller
 * skips the trigger entirely.
 *
 * One Prisma read; the join chain is `Feature → Milestone → Initiative
 * → SourceControlOrg` to recover the channel name (`githubLogin`).
 */
export async function resolveAffectedCanvasRefs(
  featureId: string,
): Promise<{ githubLogin: string; refs: string[] } | null> {
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      milestoneId: true,
      milestone: {
        select: {
          id: true,
          initiativeId: true,
          initiative: {
            select: {
              id: true,
              org: { select: { githubLogin: true } },
            },
          },
        },
      },
    },
  });
  if (!feature?.milestone?.initiative?.org?.githubLogin) return null;
  return {
    githubLogin: feature.milestone.initiative.org.githubLogin,
    refs: [
      "", // root: initiative card rollup
      `initiative:${feature.milestone.initiativeId}`, // milestone timeline
      `milestone:${feature.milestone.id}`, // feature/task sub-canvas
    ],
  };
}

/**
 * Fire CANVAS_UPDATED on the affected canvases for a feature whose
 * tasks just changed. No-op when the feature isn't linked to a
 * milestone. Errors are swallowed to keep the calling mutation
 * resilient to Pusher outages.
 *
 * Returns a Promise that callers MAY await for ordering (e.g. tests);
 * production callers fire-and-forget via `void notifyFeatureCanvasRefresh(...)`.
 */
export async function notifyFeatureCanvasRefresh(
  featureId: string,
  action = "feature-task-progress",
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const affected = await resolveAffectedCanvasRefs(featureId);
    if (!affected) return;
    await notifyCanvasesUpdatedByLogin(
      affected.githubLogin,
      affected.refs,
      action,
      { featureId, ...(detail ?? {}) },
    );
  } catch (e) {
    console.error("[feature-canvas-notify] failed to notify:", e);
  }
}
