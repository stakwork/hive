"use client";

import { useCallback, useEffect } from "react";
import {
  addEdge,
  addNode,
  removeEdge,
  removeNode,
  updateEdge,
  type CanvasEdge,
  type CanvasNode,
  type CanvasData,
  type EdgeUpdate,
  type SystemCanvasHandle,
} from "system-canvas-react";
import { toast } from "sonner";
import { isLiveId } from "@/lib/canvas";

/**
 * Authored-node categories that can be drag-dropped onto a live
 * container card (workspace / initiative) to move them between canvas
 * blobs. `"text"` is the library's base type used by the `+ Text`
 * menu pick; including it lets users shuffle plain text cards too.
 *
 * Module-level so the arrays' identity stays stable across renders
 * and `useCallback` deps don't churn.
 */
export const AUTHORED_DROPPABLE_CATEGORIES = ["note", "decision", "text"];

/**
 * Live container categories that own a sub-canvas an authored node
 * can be moved into. Mirrors the `ref: liveId` projections in
 * `src/lib/canvas/projectors.ts` — workspaces and initiatives each
 * drill. Milestones are intentionally NOT in this list: they render
 * as cards on the initiative canvas and are not drillable, so there
 * is no sub-canvas to drop authored notes onto. Features also don't
 * drill (no `ref` in v1 per the projector); attempting to move an
 * authored node onto a feature or milestone would have nowhere to land.
 */
export const LIVE_CONTAINER_CATEGORIES = ["workspace", "initiative"];

interface UseCanvasEdgeOpsOptions {
  githubLogin: string;
  applyMutation: (canvasRef: string | undefined, mutate: (data: CanvasData) => CanvasData) => void;
  edgePatchHandleRef?: React.RefObject<((id: string, patch: EdgeUpdate, canvasRef: string | undefined) => void) | null>;
  canvasHandleRef: React.RefObject<SystemCanvasHandle | null>;
  subCanvasesRef: React.RefObject<Record<string, CanvasData>>;
}

interface UseCanvasEdgeOpsReturn {
  handleEdgeAdd: (edge: CanvasEdge, canvasRef: string | undefined) => void;
  handleEdgeUpdate: (id: string, patch: EdgeUpdate, canvasRef: string | undefined) => void;
  handleEdgeDelete: (id: string, canvasRef: string | undefined) => void;
  canDropNodeOn: (sources: CanvasNode[], target: CanvasNode) => boolean;
  handleNodeDrop: (sources: CanvasNode[], target: CanvasNode, ctx: { canvasRef: string | undefined }) => void;
}

export function useCanvasEdgeOps({
  githubLogin,
  applyMutation,
  edgePatchHandleRef,
  canvasHandleRef,
  subCanvasesRef,
}: UseCanvasEdgeOpsOptions): UseCanvasEdgeOpsReturn {
  /**
   * Detect a user-drawn edge whose endpoints are a feature card and a
   * milestone card on the initiative canvas. Either direction is
   * accepted (feature → milestone or milestone → feature). Returns
   * `{ featureId, milestoneId }` for the membership PATCH or `null`
   * when the edge is something else (feature-to-feature dependency,
   * authored note → live container, etc. — those flow through the
   * default blob path).
   */
  const detectFeatureMilestoneEdge = useCallback(
    (
      edge: CanvasEdge,
    ): { featureId: string; milestoneId: string } | null => {
      const a = edge.fromNode;
      const b = edge.toNode;
      if (a.startsWith("feature:") && b.startsWith("milestone:")) {
        return {
          featureId: a.slice("feature:".length),
          milestoneId: b.slice("milestone:".length),
        };
      }
      if (a.startsWith("milestone:") && b.startsWith("feature:")) {
        return {
          featureId: b.slice("feature:".length),
          milestoneId: a.slice("milestone:".length),
        };
      }
      return null;
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that attaches a feature to a milestone via
   * `Feature.milestoneId`. Same shape as the drag-drop reassignment
   * path (`reassignFeatureToMilestone`), used here so user-drawn
   * edges express DB membership instead of authored-blob edges.
   * Pass `null` to detach. The Pusher fan-out from the API route
   * handles the canvas refresh; the synthetic edge appears (or
   * disappears) on the next read.
   */
  const patchFeatureMilestone = useCallback(
    async (featureId: string, milestoneId: string | null) => {
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] patchFeatureMilestone failed",
            res.status,
            detail,
          );
          toast.error("Failed to assign feature to milestone");
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] patchFeatureMilestone threw", err);
        toast.error("Failed to assign feature to milestone");
      }
    },
    [],
  );

  /**
   * Detect a user-drawn edge whose endpoints are two feature cards on
   * the initiative canvas. The direction matters: the source is the
   * BLOCKER (the dependency, the thing that must finish first), the
   * target is the BLOCKED (the dependent feature whose
   * `dependsOnFeatureIds` array will gain the blocker's id). Returns
   * `null` for any other shape — milestone↔feature edges are caught
   * by `detectFeatureMilestoneEdge` above; the milestone check runs
   * first in `handleEdgeAdd`.
   */
  const detectFeatureBlocksEdge = useCallback(
    (
      edge: CanvasEdge,
    ): { blockerId: string; blockedId: string } | null => {
      const a = edge.fromNode;
      const b = edge.toNode;
      if (a.startsWith("feature:") && b.startsWith("feature:")) {
        return {
          blockerId: a.slice("feature:".length),
          blockedId: b.slice("feature:".length),
        };
      }
      return null;
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that adds or removes a blocker on a
   * feature's `dependsOnFeatureIds` array. Read-modify-write because
   * the column is a flat string array; the service-layer
   * `updateFeature` runs validation + the cycle check before writing.
   * Pass `mode: "add"` to append (no-op if already present) or
   * `"remove"` to filter out. The Pusher fan-out (reused
   * `notifyFeatureContentRefresh`) handles the canvas refresh.
   */
  const patchFeatureBlocks = useCallback(
    async (
      blockedId: string,
      blockerId: string,
      mode: "add" | "remove",
    ) => {
      try {
        // Read current array first — `dependsOnFeatureIds` is a flat
        // column and the API expects the full replacement set.
        const readRes = await fetch(`/api/features/${blockedId}`);
        if (!readRes.ok) {
          console.error(
            "[OrgCanvasBackground] patchFeatureBlocks read failed",
            readRes.status,
          );
          return;
        }
        const readBody = await readRes.json();
        const current: string[] =
          (readBody?.data?.dependsOnFeatureIds as string[] | undefined) ?? [];
        const next =
          mode === "add"
            ? Array.from(new Set([...current, blockerId]))
            : current.filter((id) => id !== blockerId);
        // Skip no-op writes — saves a round trip and avoids
        // emitting CANVAS_UPDATED for a write that didn't change
        // anything.
        if (
          next.length === current.length &&
          next.every((id, i) => id === current[i])
        ) {
          return;
        }
        const res = await fetch(`/api/features/${blockedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dependsOnFeatureIds: next }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] patchFeatureBlocks failed",
            res.status,
            detail,
          );
          toast.error("Failed to update dependency");
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] patchFeatureBlocks threw", err);
        toast.error("Failed to update dependency");
      }
    },
    [],
  );

  const handleEdgeAdd = useCallback(
    (edge: CanvasEdge, canvasRef: string | undefined) => {
      // Intercept feature↔milestone edges as DB membership writes
      // rather than authored-blob edges. The relationship is owned by
      // `Feature.milestoneId`; the projector emits a synthetic edge
      // on every read to visually represent it. Letting the
      // user-drawn edge sit in the blob alongside the synthetic one
      // would create two parallel representations that can disagree
      // when the DB is mutated through other paths.
      //
      // To avoid the user seeing their edge "disappear and reappear"
      // across the PATCH + Pusher round-trip, we **rename** the
      // edge's id in place to the predicted synthetic id rather than
      // removing it. Two consequences fall out for free:
      //   1. The autosave splitter (`splitCanvas`) filters out
      //      `synthetic:` ids, so this optimistic edge is never
      //      persisted into the blob — DB membership stays the only
      //      source of truth.
      //   2. When the Pusher-driven refetch lands ~hundreds of ms
      //      later carrying the real projector-emitted synthetic
      //      edge, it has the *same* id and endpoints, so React's
      //      diff is a no-op — the user sees a continuous edge
      //      throughout.
      // The id format must match what `milestoneTimelineProjector`
      // emits: `synthetic:feature-milestone:<featureId>`. Drift here
      // would silently double-render edges across the round-trip.
      const link = detectFeatureMilestoneEdge(edge);
      if (link) {
        const syntheticId = `synthetic:feature-milestone:${link.featureId}`;
        // Canonicalize the optimistic edge to match exactly what
        // `milestoneTimelineProjector` will emit on the next refetch
        // — same id, same endpoint order (feature→milestone), and
        // crucially **no `fromSide`/`toSide`** so the library's
        // auto-router routes both versions identically. With matching
        // shape, the Pusher-driven swap is a React diff no-op and
        // the user sees a continuous edge throughout the round-trip.
        // Synthetic edges are DB-derived layout, not user-authored;
        // we intentionally don't preserve which handle the user
        // happened to click — trust the auto-router.
        applyMutation(canvasRef, (c) => {
          const withoutTemp = removeEdge(c, edge.id);
          // Skip if the projector-emitted edge is already in the
          // canvas (e.g. user re-drew an edge that already exists).
          // Adding a duplicate id would crash the library.
          if (withoutTemp.edges?.some((e) => e.id === syntheticId)) {
            return withoutTemp;
          }
          return addEdge(withoutTemp, {
            id: syntheticId,
            fromNode: `feature:${link.featureId}`,
            toNode: `milestone:${link.milestoneId}`,
          } as CanvasEdge);
        });
        void patchFeatureMilestone(link.featureId, link.milestoneId);
        return;
      }

      // Feature→feature dependency edge (the "blocks" relation). Same
      // pattern as the milestone interception: swap the user-drawn
      // edge's id for the predicted synthetic id, PATCH the DB, let
      // the Pusher-driven refetch confirm via the projector. The
      // server-side cycle check in `updateFeature` rejects the write
      // if it would create a cycle — the optimistic edge then sits
      // briefly until the next refetch removes it (the projector
      // won't re-emit a non-persisted dependency).
      const blocksLink = detectFeatureBlocksEdge(edge);
      if (blocksLink && blocksLink.blockerId !== blocksLink.blockedId) {
        const syntheticId =
          `synthetic:feature-blocks:${blocksLink.blockerId}:${blocksLink.blockedId}`;
        applyMutation(canvasRef, (c) => {
          const withoutTemp = removeEdge(c, edge.id);
          if (withoutTemp.edges?.some((e) => e.id === syntheticId)) {
            return withoutTemp;
          }
          return addEdge(withoutTemp, {
            id: syntheticId,
            fromNode: `feature:${blocksLink.blockerId}`,
            toNode: `feature:${blocksLink.blockedId}`,
            customData: { kind: "blocks" },
          } as CanvasEdge);
        });
        void patchFeatureBlocks(
          blocksLink.blockedId,
          blocksLink.blockerId,
          "add",
        );
        return;
      }

      applyMutation(canvasRef, (c) => addEdge(c, edge));
    },
    [
      applyMutation,
      detectFeatureMilestoneEdge,
      patchFeatureMilestone,
      detectFeatureBlocksEdge,
      patchFeatureBlocks,
    ],
  );
  const handleEdgeUpdate = useCallback(
    (id: string, patch: EdgeUpdate, canvasRef: string | undefined) => {
      // Synthetic edges (DB-projected feature→milestone membership) are
      // not in the blob, so library `updateEdge` calls against them
      // would no-op silently. The most common "update" on a synthetic
      // edge would be repointing one endpoint — that's a membership
      // change, which belongs as a PATCH. Defensive guard: ignore
      // patches addressed at synthetic ids.
      if (id.startsWith("synthetic:")) return;
      applyMutation(canvasRef, (c) => updateEdge(c, id, patch));
    },
    [applyMutation],
  );
  const handleEdgeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      // Deleting a synthetic feature→milestone membership edge means
      // "this feature is no longer in this milestone" — a DB write,
      // not a blob delete. PATCH `milestoneId: null`; the projector
      // re-runs and the synthetic edge disappears.
      //
      // We ALSO optimistically remove it from local state so the
      // user sees the edge disappear immediately rather than
      // lingering until the Pusher refetch lands. `splitCanvas`
      // filters `synthetic:` ids so this removal doesn't produce an
      // extraneous authored-edge delete in the persisted blob.
      if (id.startsWith("synthetic:feature-milestone:")) {
        const featureId = id.slice("synthetic:feature-milestone:".length);
        applyMutation(canvasRef, (c) => removeEdge(c, id));
        void patchFeatureMilestone(featureId, null);
        return;
      }
      // Deleting a synthetic dependency edge means "this feature no
      // longer depends on that one." Same posture as the milestone
      // case: optimistic local remove, then PATCH the
      // `dependsOnFeatureIds` array minus the blocker. Id format:
      // `synthetic:feature-blocks:<blockerId>:<blockedId>`.
      if (id.startsWith("synthetic:feature-blocks:")) {
        const ids = id.slice("synthetic:feature-blocks:".length).split(":");
        if (ids.length === 2) {
          const [blockerId, blockedId] = ids;
          applyMutation(canvasRef, (c) => removeEdge(c, id));
          void patchFeatureBlocks(blockedId, blockerId, "remove");
          return;
        }
      }
      applyMutation(canvasRef, (c) => removeEdge(c, id));
    },
    [applyMutation, patchFeatureMilestone, patchFeatureBlocks],
  );

  // Expose the edge-patch path through the parent-supplied ref so
  // sibling surfaces (the Connections-tab link mode) can write
  // `customData.connectionId` without prop-drilling a callback
  // through every list row. Re-wire on every render so the latest
  // closure is always exposed (the ref's identity is stable, the
  // function it points at is not — that's the desired semantics).
  useEffect(() => {
    if (!edgePatchHandleRef) return;
    edgePatchHandleRef.current = handleEdgeUpdate;
    return () => {
      // Null out on unmount so a stale handler can't fire after the
      // canvas tears down.
      if (edgePatchHandleRef.current === handleEdgeUpdate) {
        edgePatchHandleRef.current = null;
      }
    };
  }, [edgePatchHandleRef, handleEdgeUpdate]);

  // -------------------------------------------------------------------
  // Drop-on-node — three pairings today:
  //
  //   1. **Feature → Milestone (DB reassign).** Drag a `feature:` card
  //      onto a `milestone:` card to PATCH `Feature.milestoneId`. The
  //      server derives `initiativeId` and fans out CANVAS_UPDATED on
  //      every affected canvas; the projector re-emits the feature on
  //      the most-specific scope.
  //
  //   2. **Authored callout → Live container (canvas move).** Drag a
  //      `note` / `decision` / base-`text` node onto a `workspace:` /
  //      `initiative:` / `milestone:` card to MOVE the authored node
  //      from its current canvas blob onto the target's sub-canvas
  //      blob. Lets the user accumulate loose thoughts on the root
  //      canvas, then organize them under the workspace / initiative /
  //      milestone they belong to without retyping. The note's text +
  //      category + customData survive the move (it's a blob-to-blob
  //      hop, not a DB write).
  //
  //   3. **Research → Initiative (DB reassign).** Drag a `research:`
  //      card onto an `initiative:` card to PATCH
  //      `Research.initiativeId`. The row jumps from the root canvas
  //      to the initiative sub-canvas (or between two initiative
  //      sub-canvases) on the next projector run. Drop coords are
  //      intentionally NOT preserved — the source and target live on
  //      different canvases, so the source's `(x, y)` has no meaning
  //      on the destination; the projector's default initiative-canvas
  //      slot is the right landing spot. Symmetric "unscope to root"
  //      isn't supported via drop today (root has no container card
  //      to drop onto); a future right-click menu or "drop on empty
  //      canvas" gesture can cover it.
  //
  // Library-side hooks: `canDropNodeOn` is the per-frame predicate
  // during drag (must be cheap — id-prefix sniff + category check, no
  // fetches, no setState); `onNodeDrop` is the release handler. The
  // library snaps the source back to its pre-drag position before
  // firing `onNodeDrop`, so we never commit a canvas-position update.
  //
  // Self-drop is filtered library-side, but we keep an explicit
  // `source.id !== target.id` line for defensive readability.
  //
  // The lookup arrays (`AUTHORED_DROPPABLE_CATEGORIES`,
  // `LIVE_CONTAINER_CATEGORIES`) live at module scope above so
  // `useCallback` deps stay stable.
  // -------------------------------------------------------------------
  const canDropNodeOn = useCallback(
    (sources: CanvasNode[], target: CanvasNode): boolean => {
      // Accept if at least one source forms a valid pairing with the
      // target. This enables multi-select drops where only some of the
      // dragged nodes are droppable onto the target.
      return sources.some((source) => {
        if (!source || source.id === target.id) return false;

        // Pairing 1: feature → milestone (DB reassign).
        if (
          source.category === "feature" &&
          target.category === "milestone" &&
          source.id.startsWith("feature:") &&
          target.id.startsWith("milestone:")
        ) {
          return true;
        }

        // Pairing 2: authored callout → live container (canvas move).
        // The source must be authored (not a live id) and the target
        // must be a container with a sub-canvas to land in.
        if (
          AUTHORED_DROPPABLE_CATEGORIES.includes(source.category ?? "") &&
          !isLiveId(source.id) &&
          LIVE_CONTAINER_CATEGORIES.includes(target.category ?? "") &&
          isLiveId(target.id)
        ) {
          return true;
        }

        // Pairing 3: research → initiative (DB reassign). Mirrors
        // pairing 1 structurally — the gesture targets a DB column,
        // not the canvas blob, so the synthetic split-between-canvases
        // happens via the projector after the fan-out.
        if (
          source.category === "research" &&
          target.category === "initiative" &&
          source.id.startsWith("research:") &&
          target.id.startsWith("initiative:")
        ) {
          return true;
        }

        return false;
      });
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that reassigns a feature to a different
   * milestone. The server derives the new `initiativeId` from the
   * milestone (via the coherence rule we shipped in `updateFeature`)
   * and fans out `CANVAS_UPDATED` on every affected canvas (root,
   * both initiatives, both milestones, workspace). We don't refetch
   * locally — the Pusher fan-out handler in this component already
   * pulls fresh data for whichever canvas the user is currently
   * looking at, plus root.
   *
   * On error we surface to the console; the user's drop visually
   * snapped back (the library handled that), so there's no stuck
   * "ghost card" to clean up. A toast belongs here when we add the
   * global toast system.
   */
  const reassignFeatureToMilestone = useCallback(
    async (featureId: string, milestoneId: string) => {
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] reassign feature failed",
            res.status,
            detail,
          );
          toast.error("Failed to reassign feature");
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] reassign feature threw",
          err,
        );
        toast.error("Failed to reassign feature");
      }
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that reassigns a research row to a different
   * initiative (or to root, with `initiativeId: null`). Same posture
   * as `reassignFeatureToMilestone`: no local refetch — the server
   * fans out `CANVAS_UPDATED` on both source and target refs via
   * `notifyResearchReassignmentRefresh`, and this component's Pusher
   * handler picks up the relevant canvas.
   *
   * On error we surface to the console; the library snapped the drop
   * back, so there's no stuck "ghost card" to clean up. A toast
   * belongs here when the global toast system lands.
   */
  const reassignResearchToInitiative = useCallback(
    async (researchId: string, initiativeId: string | null) => {
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/research/${researchId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initiativeId }),
          },
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] reassign research failed",
            res.status,
            detail,
          );
          toast.error("Failed to reassign research");
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] reassign research threw",
          err,
        );
        toast.error("Failed to reassign research");
      }
    },
    [githubLogin],
  );

  /**
   * Move an authored node from the source canvas blob to the target's
   * sub-canvas blob. Two side-effects:
   *
   *   1. **Remove** the node from `currentRef` (the canvas the user is
   *      looking at). Routes through `applyMutation` so it's
   *      optimistic, undoable via Ctrl-Z, and rides the standard
   *      autosave flush that already covers in-flight blob writes.
   *
   *   2. **Add** the node to the target's sub-canvas via a direct
   *      read-modify-write PUT. The target canvas may not be cached
   *      locally (the user might never have drilled into it), so
   *      we use the same pattern as `savePositionForLiveId`: fetch
   *      the latest blob, append the node, PUT it back. The PUT
   *      emits `CANVAS_UPDATED` server-side; both canvases (the one
   *      we removed from + the one we added to) refetch via the
   *      existing Pusher handler, so the user sees the move land on
   *      the target if they drill in.
   *
   * The node's `id` / `text` / `category` / `customData` survive the
   * move verbatim. Position is preserved as-is from the source — the
   * user can drag it once they drill into the target. Resetting `(x,
   * y)` to a projector-default would be marginally nicer but means
   * computing each target's empty-canvas anchor; not worth the
   * complexity for v1.
   *
   * On a server-side write failure, the source-canvas remove already
   * landed locally. The autosave will eventually flush that removal,
   * leaving the user with a "lost note" if the target write also
   * failed. Acceptable for v1 (Ctrl-Z undoes the source removal); a
   * proper rollback would need the consumer-side undo stack to track
   * cross-canvas paired actions, which is overkill here.
   */
  const moveAuthoredNodesToCanvas = useCallback(
    async (
      sourceCanvasRef: string | undefined,
      sourceNodes: CanvasNode[],
      targetCanvasRef: string,
    ) => {
      if (sourceNodes.length === 0) return;

      const movedIds = new Set(sourceNodes.map((n) => n.id));
      applyMutation(sourceCanvasRef, (c) => {
        let next = c;
        for (const id of movedIds) next = removeNode(next, id);
        return next;
      });

      try {
        const url = `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(targetCanvasRef)}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.error(
            "[useCanvasEdgeOps] moveAuthoredNodesToCanvas read failed",
            res.status,
          );
          toast.error("Failed to move node");
          return;
        }
        const body = await res.json();
        const data: CanvasData = body.data ?? { nodes: [], edges: [] };
        const existingNodes = data.nodes ?? [];
        const nextNodes: CanvasNode[] = [
          ...existingNodes.filter((n) => !movedIds.has(n.id)),
          ...sourceNodes,
        ];
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { ...data, nodes: nextNodes } }),
        });
        if (!putRes.ok) {
          console.error(
            "[useCanvasEdgeOps] moveAuthoredNodesToCanvas write failed",
            putRes.status,
          );
          toast.error("Failed to move node");
        }
      } catch (err) {
        console.error(
          "[useCanvasEdgeOps] moveAuthoredNodesToCanvas threw",
          err,
        );
        toast.error("Failed to move node");
      }
    },
    [applyMutation, githubLogin],
  );

  const handleNodeDrop = useCallback(
    (
      sources: CanvasNode[],
      target: CanvasNode,
      ctx: { canvasRef: string | undefined },
    ) => {
      const authoredToMove: CanvasNode[] = [];

      for (const source of sources) {
        if (!source) continue;

        if (
          source.category === "feature" &&
          target.category === "milestone" &&
          source.id.startsWith("feature:") &&
          target.id.startsWith("milestone:")
        ) {
          const featureId = source.id.slice("feature:".length);
          const milestoneId = target.id.slice("milestone:".length);

          // Resolve old milestoneId from the synthetic edge the projector
          // emitted for this feature's current membership (if any).
          const canvas = ctx.canvasRef
            ? subCanvasesRef.current[ctx.canvasRef]
            : undefined;
          const syntheticEdgeId = `synthetic:feature-milestone:${featureId}`;
          const oldEdge = canvas?.edges?.find((e) => e.id === syntheticEdgeId);
          const oldMilestoneId = oldEdge
            ? oldEdge.toNode.slice("milestone:".length)
            : null;

          void reassignFeatureToMilestone(featureId, milestoneId);
          canvasHandleRef.current?.pushUndoEntry({
            forward: () => void reassignFeatureToMilestone(featureId, milestoneId),
            backward: () => void patchFeatureMilestone(featureId, oldMilestoneId),
            canvasRef: ctx.canvasRef,
          });
          continue;
        }

        if (
          AUTHORED_DROPPABLE_CATEGORIES.includes(source.category ?? "") &&
          !isLiveId(source.id) &&
          LIVE_CONTAINER_CATEGORIES.includes(target.category ?? "") &&
          target.ref
        ) {
          authoredToMove.push(source);
          continue;
        }

        if (
          source.category === "research" &&
          target.category === "initiative" &&
          source.id.startsWith("research:") &&
          target.id.startsWith("initiative:")
        ) {
          const researchId = source.id.slice("research:".length);
          const initiativeId = target.id.slice("initiative:".length);

          // Derive old initiativeId from the canvas the research currently
          // lives on. If the user is on `initiative:X`, old = X; if on
          // root, old = null (the research was unscoped).
          const oldInitiativeId = ctx.canvasRef?.startsWith("initiative:")
            ? ctx.canvasRef.slice("initiative:".length)
            : null;

          void reassignResearchToInitiative(researchId, initiativeId);
          canvasHandleRef.current?.pushUndoEntry({
            forward: () => void reassignResearchToInitiative(researchId, initiativeId),
            backward: () => void reassignResearchToInitiative(researchId, oldInitiativeId),
            canvasRef: ctx.canvasRef,
          });
          continue;
        }
      }

      if (authoredToMove.length > 0 && target.ref) {
        const targetRef = target.ref;
        const sourceRef = ctx.canvasRef;

        void moveAuthoredNodesToCanvas(sourceRef, authoredToMove, targetRef);
        canvasHandleRef.current?.pushUndoEntry({
          forward: () => void moveAuthoredNodesToCanvas(sourceRef, authoredToMove, targetRef),
          backward: () => {
            // Re-add to source canvas locally (applyMutation queues autosave)
            applyMutation(sourceRef, (c) => {
              let next = c;
              for (const node of authoredToMove) next = addNode(next, node);
              return next;
            });
            // Remove from target canvas via read-modify-write PUT
            const movedIds = new Set(authoredToMove.map((n) => n.id));
            void (async () => {
              try {
                const url = `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(targetRef)}`;
                const res = await fetch(url);
                if (!res.ok) return;
                const body = await res.json();
                const data: CanvasData = body.data ?? { nodes: [], edges: [] };
                const nextNodes = (data.nodes ?? []).filter((n) => !movedIds.has(n.id));
                await fetch(url, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ data: { ...data, nodes: nextNodes } }),
                });
              } catch {
                // Best-effort undo — the Pusher refetch will reconcile
              }
            })();
          },
          canvasRef: ctx.canvasRef,
        });
      }
    },
    [
      reassignFeatureToMilestone,
      patchFeatureMilestone,
      moveAuthoredNodesToCanvas,
      reassignResearchToInitiative,
      applyMutation,
      githubLogin,
      canvasHandleRef,
      subCanvasesRef,
    ],
  );

  return {
    handleEdgeAdd,
    handleEdgeUpdate,
    handleEdgeDelete,
    canDropNodeOn,
    handleNodeDrop,
  };
}
