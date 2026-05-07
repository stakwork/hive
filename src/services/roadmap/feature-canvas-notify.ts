/**
 * Canvas-refresh fan-out for feature/task mutations.
 *
 * When a Feature's `status` or any of its child Tasks' `workflowStatus`
 * change, the org canvas's milestone card needs to re-project. The
 * affected canvases are:
 *
 *   - root (`""`)                            — initiative card progress rollup
 *   - `initiative:<initiativeId>`            — milestone card + feature
 *                                              card on the initiative
 *                                              canvas (no milestone
 *                                              sub-canvas exists)
 *
 * Why every caller, every time:
 *   - The milestone card's `customData.progress` fraction changes
 *     when any child task transitions DONE.
 *   - The milestone card's `customData.agentCount` (PENDING +
 *     IN_PROGRESS task count) changes whenever a task enters or
 *     leaves either of those workflow states — possibly without the
 *     feature's own status flipping.
 *   - The feature card on the initiative canvas surfaces its own
 *     task progress in `customData.secondary`, so task mutations
 *     also change what that card displays.
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
      `initiative:${feature.milestone.initiativeId}`, // milestone + feature cards live here
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
 * Fan-out helper for **feature content changes that don't move the
 * feature between canvases** (e.g. title rename via the canvas card,
 * board, or REST API). Refreshes every canvas the feature actually
 * projects on — the workspace canvas (where loose features render)
 * and the parent initiative canvas (where anchored features render).
 * Root is included because the initiative-card progress rollups
 * embed the feature's title-derived label on hover/inspection paths
 * (cheap to refresh; safer than reasoning about which derived fields
 * a future projector might surface).
 *
 * Differs from `notifyFeatureCanvasRefresh` (which only knows about
 * the milestone/initiative chain) by also covering the workspace
 * placement, and from `notifyFeatureReassignmentRefresh` by not
 * needing a `before` snapshot (no anchor changed).
 *
 * Fire-and-forget; errors swallowed.
 */
export async function notifyFeatureContentRefresh(
  featureId: string,
  action = "feature-content",
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
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
    if (!githubLogin) return;

    const refs = new Set<string>();
    refs.add(""); // root
    refs.add(`ws:${feature.workspaceId}`); // loose features render here
    if (feature.initiativeId) {
      refs.add(`initiative:${feature.initiativeId}`);
    }
    // Cover the unusual case where initiativeId is null but the
    // milestone chain points at one (defensive against direct DB
    // writes that bypass the coherence rule).
    if (feature.milestone?.initiativeId) {
      refs.add(`initiative:${feature.milestone.initiativeId}`);
    }

    await notifyCanvasesUpdatedByLogin(
      githubLogin,
      Array.from(refs),
      action,
      { featureId, ...(detail ?? {}) },
    );
  } catch (e) {
    console.error(
      "[feature-canvas-notify] notifyFeatureContentRefresh failed:",
      e,
    );
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
 * Every initiative the feature was attached to before AND after the
 * change is included; root is always added; the workspace canvas is
 * touched in case the feature went loose. Milestone-bound features
 * render on their parent initiative's canvas (with a synthetic edge
 * to the milestone card on the same canvas), so a milestone change
 * alone refreshes via the parent initiative's ref — there is no
 * separate `milestone:<id>` ref to fan out to. Duplicates are
 * de-duped by `notifyCanvasesUpdatedByLogin`.
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

    // Both anchored initiatives (before + after) host their milestones
    // AND every initiative-anchored feature (with or without a
    // milestone), plus the synthetic edges that express milestone
    // membership. A milestone-only change still refreshes via the
    // parent initiative — that's where the membership edge lives.
    // Milestone reassignments derive the parent initiative through the
    // `milestone.initiativeId` chain, which the helper resolves
    // implicitly via `feature.initiativeId` post-update; the "before"
    // initiative covers the leaving side.
    if (before.initiativeId) {
      refs.add(`initiative:${before.initiativeId}`);
    }
    if (feature.initiativeId) {
      refs.add(`initiative:${feature.initiativeId}`);
    }
    // Cover the unusual case where a feature's milestone changed but
    // its initiativeId snapshot was null on the before side (e.g.
    // direct DB write that bypassed the coherence rule). The
    // milestone's parent initiative is the canvas to refresh.
    if (feature.milestone?.initiativeId) {
      refs.add(`initiative:${feature.milestone.initiativeId}`);
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
