/**
 * Feature projection rules — single source of truth for "where does
 * a feature with this (workspaceId, initiativeId, milestoneId) triple
 * actually render?"
 *
 * The "most specific place wins" rule lives here so the projector,
 * the `+ Feature` create dialog, and the proposal-approval handler
 * all agree. Drift between the projector and the approval handler
 * would be silent: the approval would write a `positions[liveId]`
 * overlay onto a canvas where the feature doesn't render, and the
 * overlay would just be dead weight.
 *
 * Mirrors the projector logic in `projectors.ts`:
 *   - milestone-bound features (`milestoneId` set) → milestone sub-canvas
 *     (`milestoneProjector`).
 *   - initiative-loose features (`initiativeId` set, `milestoneId` null)
 *     → initiative sub-canvas (`milestoneTimelineProjector` loose-features
 *     row).
 *   - loose features (no initiative, no milestone) → workspace sub-canvas
 *     (`workspaceProjector` loose-features row).
 *   - root canvas never shows features.
 *
 * Both functions are pure; tests live next to the helper.
 */
import { ROOT_REF } from "./scope";

export interface FeaturePlacementPayload {
  workspaceId: string;
  initiativeId?: string | null;
  milestoneId?: string | null;
}

/**
 * Returns true iff a feature with the given placement triple would be
 * emitted on the canvas identified by `ref`. Used by the proposal-
 * approval handler to decide whether to write a `positions[liveId]`
 * overlay on the user's current canvas: only legal when the feature
 * actually projects there.
 *
 * The `ref === ROOT_REF` early-return is load-bearing — without it,
 * `ref.startsWith(...)` would never match and the function would fall
 * through to `false`, which is correct but obscures intent.
 */
export function featureProjectsOn(
  ref: string,
  payload: FeaturePlacementPayload,
): boolean {
  if (ref === ROOT_REF) return false;

  if (ref.startsWith("milestone:")) {
    const milestoneId = ref.slice("milestone:".length);
    return Boolean(payload.milestoneId) && payload.milestoneId === milestoneId;
  }

  if (ref.startsWith("initiative:")) {
    const initiativeId = ref.slice("initiative:".length);
    // Initiative-loose features only — a feature with a milestone
    // attached projects on the milestone, not the initiative timeline.
    return (
      Boolean(payload.initiativeId) &&
      payload.initiativeId === initiativeId &&
      !payload.milestoneId
    );
  }

  if (ref.startsWith("ws:")) {
    const workspaceId = ref.slice("ws:".length);
    // Loose features only — anchored features render on their
    // initiative or milestone canvas, never on the workspace.
    return (
      payload.workspaceId === workspaceId &&
      !payload.initiativeId &&
      !payload.milestoneId
    );
  }

  // milestone:/initiative:/ws: are the three feature-bearing scopes.
  // Anything else (feature:<id>, node:<id>, opaque refs) never shows
  // features.
  return false;
}

/**
 * Returns the canvas ref a feature with the given triple projects on,
 * by the "most specific place wins" rule. Used as the fallback
 * `landedOn` when the user's `currentRef` doesn't match the projection
 * (the new node is created, but it lands on a different canvas than
 * the one the user was looking at).
 *
 * Never returns `ROOT_REF` — features don't project on the root.
 */
export function mostSpecificRef(payload: FeaturePlacementPayload): string {
  if (payload.milestoneId) return `milestone:${payload.milestoneId}`;
  if (payload.initiativeId) return `initiative:${payload.initiativeId}`;
  return `ws:${payload.workspaceId}`;
}
