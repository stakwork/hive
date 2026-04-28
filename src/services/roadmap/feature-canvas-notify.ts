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

/**
 * Fan-out helper for **feature reassignment** (canvas drag-and-drop or
 * any other path that changes `milestoneId` / `initiativeId`). Differs
 * from `notifyFeatureCanvasRefresh` in two ways:
 *
 *   1. It accepts an explicit `before` snapshot — both the previous
 *      milestone/initiative ids — so we can refresh the canvas the
 *      feature **left** in addition to the canvas it landed on.
 *   2. It always touches root (initiative-card progress rollups shift
 *      whenever a feature changes milestone-membership).
 *
 * Every milestone/initiative the feature was attached to before AND
 * after the change is included; root is always added; duplicates are
 * de-duped by `notifyCanvasesUpdatedByLogin`. Initiative-only and
 * loose-feature canvases are covered too: when a feature lives on
 * `milestoneTimelineProjector` (initiative set, milestone null) or
 * `workspaceProjector` (both null), reassigning it on/off a milestone
 * changes which projector emits it — we refresh those scopes too.
 *
 * Errors are swallowed for the same resilience reason as
 * `notifyFeatureCanvasRefresh`.
 */
export async function notifyFeatureReassignmentRefresh(
  featureId: string,
  before: {
    milestoneId: string | null;
    initiativeId: string | null;
    workspaceId: string;
  },
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    // Pull the post-change feature + its org login. The org login is
    // resolved through the **workspace** because either anchor pair
    // (initiative or milestone+initiative) might be null after the
    // change — workspace is the only always-present link to an org.
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        milestoneId: true,
        initiativeId: true,
        workspaceId: true,
        workspace: {
          select: {
            sourceControlOrg: { select: { githubLogin: true } },
          },
        },
        milestone: { select: { initiativeId: true } },
      },
    });
    const githubLogin = feature?.workspace?.sourceControlOrg?.githubLogin;
    if (!githubLogin) {
      // No org → no org canvas to refresh. Quiet no-op.
      return;
    }

    const refs = new Set<string>();
    // Root: initiative-card progress rollups always shift.
    refs.add("");

    // Workspace canvas projects loose features (no initiative/milestone).
    // Add it whenever the feature was, or now is, loose so the
    // workspaceProjector pulls a fresh list. Cheaper to always add than
    // to reason about every case — the projector will simply not find
    // it on the workspace canvas if neither side was loose.
    refs.add(`ws:${before.workspaceId}`);
    if (feature.workspaceId !== before.workspaceId) {
      // Defensive: workspace reassignment isn't supported by the canvas
      // UI today, but the helper is general — cover it for free.
      refs.add(`ws:${feature.workspaceId}`);
    }

    // Both anchored initiatives (before + after) project initiative-loose
    // and host milestone timelines. Either could change.
    if (before.initiativeId) {
      refs.add(`initiative:${before.initiativeId}`);
    }
    if (feature.initiativeId) {
      refs.add(`initiative:${feature.initiativeId}`);
    }

    // Both milestones (before + after) need their feature column lists
    // re-projected. Either may be null when the feature is being
    // attached to / detached from a milestone.
    if (before.milestoneId) {
      refs.add(`milestone:${before.milestoneId}`);
    }
    if (feature.milestoneId) {
      refs.add(`milestone:${feature.milestoneId}`);
    }

    await notifyCanvasesUpdatedByLogin(
      githubLogin,
      Array.from(refs),
      "feature-reassigned",
      { featureId, ...(detail ?? {}) },
    );
  } catch (e) {
    console.error(
      "[feature-canvas-notify] notifyFeatureReassignmentRefresh failed:",
      e,
    );
  }
}
