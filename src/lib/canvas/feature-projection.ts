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
 *   - features anchored to an initiative (`initiativeId` set, with or
 *     without `milestoneId`) → initiative sub-canvas. The
 *     `milestoneTimelineProjector` emits the feature card alongside
 *     the milestone cards, plus a synthetic edge to the milestone
 *     when one is set.
 *   - loose features (no initiative, no milestone) → workspace
 *     sub-canvas (`workspaceProjector` loose-features row).
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

  if (ref.startsWith("initiative:")) {
    const initiativeId = ref.slice("initiative:".length);
    // Every feature anchored to this initiative projects here —
    // milestone-bound and initiative-loose alike. Milestone membership
    // is expressed via a projector-emitted synthetic edge to the
    // milestone card on the same canvas, NOT by relocating the
    // feature to a separate sub-canvas.
    return Boolean(payload.initiativeId) && payload.initiativeId === initiativeId;
  }

  if (ref.startsWith("ws:")) {
    const workspaceId = ref.slice("ws:".length);
    // Loose features only — anchored features render on their
    // initiative canvas, never on the workspace.
    return (
      payload.workspaceId === workspaceId &&
      !payload.initiativeId &&
      !payload.milestoneId
    );
  }

  // initiative:/ws: are the two feature-bearing scopes. Anything else
  // (feature:<id>, node:<id>, opaque refs, leftover milestone:<id> from
  // pre-cutover deep links) never shows features.
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
 *
 * `milestoneId` does NOT push the ref to a `milestone:` scope (no such
 * scope exists). A milestone-bound feature renders on its parent
 * initiative's canvas; the caller is expected to pass `initiativeId`
 * alongside `milestoneId` (the service-side coherence rule in
 * `services/roadmap/features.ts` derives one from the other so this
 * holds in practice).
 */
export function mostSpecificRef(payload: FeaturePlacementPayload): string {
  if (payload.initiativeId) return `initiative:${payload.initiativeId}`;
  return `ws:${payload.workspaceId}`;
}
