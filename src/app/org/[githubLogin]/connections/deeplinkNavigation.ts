/**
 * Cross-scope deep-link navigation for the org canvas.
 *
 * Shared execution path for every "focus this node" command the canvas
 * receives: the chat's `CanvasDeeplinkChip` (via the store's
 * `pendingDeeplink` slot) and the Live Now panel rows. Extracted from
 * `OrgCanvasBackground`'s `pendingDeeplink` effect and re-exported from
 * there so consumers have a single public symbol.
 *
 * ## Why this is a helper, not the effect body
 *
 * Two real bugs lived in the original effect body, both only reachable
 * from a *cross-scope* jump (e.g. clicking a Live Now row while drilled
 * into a sibling sub-canvas — a path the chip flow was never exercised
 * on, being guarded to fire once from root):
 *
 * 1. **Silent cross-scope no-op.** `handle.zoomIntoNode(ref)` resolves
 *    against the *currently mounted* canvas's nodes and silently
 *    resolves when the id is absent. From inside sub-canvas A, a jump
 *    to `initiative:B` therefore did nothing. The fix: when the target
 *    ref differs from the current ref and we are not already on root,
 *    call `handle.navigateToRoot()` first, wait for React to swap the
 *    mounted canvas, then drill in. Navigation is skipped entirely when
 *    already on the target ref.
 *
 * 2. **Stale ref in the post-navigation scroll.** The old scroll step
 *    read `currentRef ? subCanvasesRef.current[currentRef] : root` from
 *    a closure that had not re-rendered when the navigation promise
 *    resolved, so the node-width lookup hit the pre-navigation canvas
 *    and `computeNodeFocusZoom` computed the wrong `targetZoom`. The
 *    fix: the landed canvas is resolved through the `getCanvasData`
 *    callback (which implementations back with `subCanvasesRef` /
 *    `rootRef` — refs, not render state) *after* navigation resolves,
 *    using the target ref as the landed ref rather than any closure
 *    captured `currentRef`.
 *
 * ## Contract
 *
 * - Never throws. A stale scope ref, a missing node, or a rejected
 *   zoom all resolve (with `false`) so the caller can react (the store
 *   effect runs `clearDeeplink()` in `finally`; a Live Now click on a
 *   `fallbackOnly` row falls back to opening the item's link).
 * - Returns `true` only when the target node was found on the landed
 *   canvas and the focus zoom was dispatched.
 */
import type { CanvasData, SystemCanvasHandle } from "system-canvas-react";
import { computeNodeFocusZoom } from "@/lib/canvas/nodeZoom";

/** A pending "focus this node" command — mirrors the chat store's `pendingDeeplink`. */
export interface DeeplinkTarget {
  nodeId: string;
  /** Canvas ref the node lives on; `""` means the root canvas. */
  canvasRef: string;
  /** Human-readable label (unused for navigation; kept for parity with the store slot). */
  label?: string;
}

export interface RunDeeplinkNavigationArgs {
  /** Imperative handle of the mounted `<SystemCanvas>`. */
  handle: SystemCanvasHandle;
  /**
   * Canvas ref mounted when navigation starts (`""` = root). This is a
   * snapshot for the "are we already there?" check only — never used to
   * resolve the post-navigation scroll.
   */
  currentRef: string;
  target: DeeplinkTarget;
  /**
   * Resolves the `CanvasData` for a ref AT CALL TIME (`""` = root).
   * Called after navigation resolves, so implementations must read the
   * live refs (`subCanvasesRef` / `rootRef`) — the landed canvas is
   * what feeds the node-width lookup, and the caller's render-time
   * closure may still hold the pre-navigation scope.
   */
  getCanvasData: (ref: string) => CanvasData | null | undefined;
  /** Container width feeding `computeNodeFocusZoom`. */
  containerWidth: number;
}

/**
 * Wait for React to swap the mounted canvas after an imperative
 * navigation. `navigateToRoot()` only schedules a state update; the
 * root's node list replaces `nodesRef.current` on the next commit.
 * Two rAFs mirror the library's own settle pattern after drill-in
 * ("the first rAF lets React commit, the second lets the post-commit
 * effects — including auto-fit — run"). Falls back to a macrotask when
 * rAF is unavailable (tests / non-visual environments).
 */
function waitForCanvasSwap(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Execute one deep-link navigation: climb to root if needed, drill into
 * the target scope, then center+zoom onto the node. See the module
 * header for the bug history and contract. Resolves `true` when the
 * node was focused, `false` when it could not be (never rejects).
 */
export async function runDeeplinkNavigation({
  handle,
  currentRef,
  target,
  getCanvasData,
  containerWidth,
}: RunDeeplinkNavigationArgs): Promise<boolean> {
  const { nodeId, canvasRef: targetRef } = target;
  if (!nodeId || !handle) return false;

  try {
    const alreadyOnTarget = currentRef === targetRef;

    // Cross-scope jump: the mounted canvas doesn't contain the target
    // scope's node, so climb to root first. (From root, `zoomIntoNode`
    // below resolves the drill-in itself.) Also covers the sub-canvas →
    // root-target case: `targetRef === ""` and we're not there.
    if (!alreadyOnTarget && currentRef !== "") {
      handle.navigateToRoot();
      await waitForCanvasSwap();
    }

    // Drill into the target scope. Resolves once the sub-canvas has
    // mounted and auto-fit — or without navigating at all when the ref
    // doesn't resolve to an on-canvas node (stale scope), in which case
    // the node lookup below simply misses. Skipped when the target IS
    // the root canvas (nothing to drill into).
    if (targetRef && !alreadyOnTarget) {
      await handle.zoomIntoNode(targetRef, { durationMs: 300 });
    }

    // Landed ref is the target ref ("" = root) — deliberately NOT
    // `currentRef`, which is the pre-navigation snapshot. `getCanvasData`
    // reads the live refs at call time, so a canvas that was just
    // fetched by the drill-in resolves here.
    const landed = getCanvasData(targetRef);
    const node = landed?.nodes?.find((n) => n.id === nodeId);
    if (!node) {
      // Node not on the landed canvas — resolve without navigating.
      // Callers fall back (Live Now opens the row's link); the store
      // effect just clears the slot.
      return false;
    }

    const targetZoom = computeNodeFocusZoom(node.width ?? 260, containerWidth);
    await handle.zoomIntoNode(nodeId, { targetZoom, durationMs: 600 });
    return true;
  } catch {
    // Best-effort navigation — a rejected zoom (node removed between
    // the lookup and the zoom, camera glitch) resolves as "not focused"
    // rather than rejecting into the caller's `finally`.
    return false;
  }
}
