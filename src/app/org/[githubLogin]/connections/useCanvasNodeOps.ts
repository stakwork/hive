"use client";

import { useCallback, useRef, useState } from "react";
import {
  addNode,
  removeNode,
  updateNode,
  type CanvasData,
  type CanvasNode,
  type NodeUpdate,
} from "system-canvas-react";
import { toast } from "sonner";
import { isLiveId } from "@/lib/canvas";
import { toggleLiveVisibility } from "./useCanvasHiddenLive";
import { fetchRoot, fetchSub } from "./useCanvasPersistence";
import {
  type InitiativeForm,
} from "@/components/initiatives/InitiativeDialog";
import {
  type MilestoneForm,
} from "@/components/initiatives/MilestoneDialog";
import {
  type FeatureCreateForm,
  type FeatureAssignForm,
} from "../_components/CreateFeatureCanvasDialog";
import type {
  InitiativeResponse,
  MilestoneResponse,
} from "@/types/initiatives";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";
import { categoryAllowedOnScope } from "./canvas-categories";


// ───────────────────────────────────────────────────────────────────────
// Module-level constant (moved from OrgCanvasBackground)
// ───────────────────────────────────────────────────────────────────────

/**
 * Categories that, when picked from the `+` menu, open a creation
 * dialog instead of dropping a node onto the canvas. The dialog hits
 * the appropriate REST API; on success the projector re-emits the new
 * node, and we save the user's click position so the node lands where
 * they clicked.
 *
 * Whether each category is *visible* in the `+` menu on the current
 * scope is decided by `categoryAllowedOnScope` in `canvas-categories.ts`
 * — see `renderAddNodeButton` below. Both filters consult the same
 * helper so a category never shows in the menu but fails the dispatch
 * (or vice versa).
 */
export const DB_CREATING_CATEGORIES = new Set(["initiative", "milestone", "feature"]);

// ───────────────────────────────────────────────────────────────────────
// PendingAdd types
// ───────────────────────────────────────────────────────────────────────

/**
 * The `canvasRef` in every variant tells us which canvas the user
 * triggered from — root (`undefined`), a workspace (`ws:<id>`), or an
 * initiative (`initiative:<id>`). The distinction matters because
 * initiatives, `initiative:<id>` for milestones.
 */
export type PendingInitiativeAdd = {
  kind: "initiative";
  x: number;
  y: number;
  canvasRef: string | undefined;
};
export type PendingMilestoneAdd = {
  kind: "milestone";
  x: number;
  y: number;
  /** Always an `initiative:<id>` ref — milestones can only be added inside one. */
  canvasRef: string;
  initiativeId: string;
  /** Count + 1 from the server; undefined if fetch failed (dialog opens with empty field). */
  defaultSequence?: number;
};
/**
 * Pending feature-create from either the `+` menu or a "Promote to
 * Feature" right-click on a note. `canvasRef` is the scope the user
 * triggered from — the dialog uses it to lock fields. `prefill` is
 * set on the Promote path; the note's text seeds title + brief.
 */
export type PendingFeatureAdd = {
  kind: "feature";
  x: number;
  y: number;
  /** Empty string ("") means root canvas; otherwise the sub-canvas ref. */
  canvasRef: string | undefined;
  prefill?: { title?: string; brief?: string };
  /**
   * If set, the dialog was opened by promoting a note. After save we
   * delete the source note from its canvas (the user "consumed" it).
   */
  sourceNoteId?: string;
};
/**
 * Pending service-create from the `+ Service` menu pick on a workspace
 * sub-canvas. Unlike initiative / milestone / feature, services are
 * NOT DB-projected — the new node lands directly in the canvas blob
 * via `applyMutation` once the dialog returns. We carry only the click
 * position and the source canvas ref through; the dialog supplies
 * the name + platform kind.
 *
 * `node` is the freshly-synthesized authored node the library handed
 * us (carrying the lib-generated id, default size from the category,
 * and the click x/y). We hold onto it so we can drop the dialog's
 * name + kind into it on save without re-synthesizing the id.
 */
export type PendingServiceAdd = {
  kind: "service";
  node: CanvasNode;
  canvasRef: string | undefined;
};
export type PendingAdd =
  | PendingInitiativeAdd
  | PendingMilestoneAdd
  | PendingFeatureAdd
  | PendingServiceAdd;

// ───────────────────────────────────────────────────────────────────────
// Options interface
// ───────────────────────────────────────────────────────────────────────

interface UseCanvasNodeOpsOptions {
  githubLogin: string;
  currentRefRef: React.RefObject<string>;
  rootRef: React.RefObject<CanvasData | null>;
  subCanvasesRef: React.RefObject<Record<string, CanvasData>>;
  applyMutation: (canvasRef: string | undefined, mutate: (data: CanvasData) => CanvasData) => void;
  setRoot: React.Dispatch<React.SetStateAction<CanvasData | null>>;
  setSubCanvases: React.Dispatch<React.SetStateAction<Record<string, CanvasData>>>;
  refreshHiddenLive: () => void;
  refreshRootHiddenLive: () => void;
}

// ───────────────────────────────────────────────────────────────────────
// Hook
// ───────────────────────────────────────────────────────────────────────

export function useCanvasNodeOps({
  githubLogin,
  currentRefRef,
  rootRef,
  subCanvasesRef,
  applyMutation,
  setRoot,
  setSubCanvases,
  refreshHiddenLive,
  refreshRootHiddenLive,
}: UseCanvasNodeOpsOptions) {
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  /**
   * Save a freshly-created live node's click position into the canvas
   * blob so it lands where the user clicked. Fire-and-forget: the API
   * response from POST already returned the new id, so we can write
   * the position before the projector re-emits the node — by the time
   * Pusher fires the refresh, the position overlay is already in place.
   */
  const savePositionForLiveId = useCallback(
    async (
      canvasRef: string | undefined,
      liveId: string,
      x: number,
      y: number,
    ) => {
      try {
        // Read-modify-write the relevant canvas. We read first so we
        // don't clobber other position overlays the user already set.
        const url = canvasRef
          ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(canvasRef)}`
          : `/api/orgs/${githubLogin}/canvas`;
        const res = await fetch(url);
        if (!res.ok) return;
        const body = await res.json();
        const data: CanvasData = body.data ?? { nodes: [], edges: [] };
        // Append a stub node carrying the position. The server's
        // splitter will treat its live id as a positions overlay and
        // discard everything else (text/category/customData). It
        // doesn't matter that the projector hasn't emitted the real
        // node yet — the position survives independently.
        const existingNodes = data.nodes ?? [];
        const nextNodes: CanvasNode[] = [
          ...existingNodes.filter((n) => n.id !== liveId),
          {
            id: liveId,
            type: "text",
            category: "",
            text: "",
            x,
            y,
          },
        ];
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { ...data, nodes: nextNodes } }),
        });
      } catch (err) {
        // Non-fatal: the node will appear at the projector's default
        // position and the user can drag it.
        console.error(
          "[OrgCanvasBackground] savePositionForLiveId failed",
          err,
        );
      }
    },
    [githubLogin],
  );

  // ===================================================================
  // Research kickoff
  // ===================================================================
  //
  // The Research feature is the first canvas node type with an
  // **authored→live** lifecycle. The user picks `+ Research` from the
  // menu, types a topic into the dropped node, and on text commit the
  // node fires a synthetic chat message that drives the agent's
  // `save_research` tool (see `src/lib/ai/researchTools.ts`).
  //
  // **The authored→live swap is NOT a client-side concern.** Earlier
  // versions of this feature tried to swap in the client (FIFO
  // queue + processed-id set + `applyMutation(removeNode)` + various
  // race-y refetch sequences). It never converged — autosave, pusher
  // refetch, and the position-overlay write all fought each other,
  // and any failure left a phantom authored node in the canvas blob.
  //
  // The swap now happens **at the IO boundary** in
  // `src/lib/canvas/io.ts` (`dedupeAuthoredResearch`): on every read
  // and every write, an authored `research` node whose text matches
  // a live `research:<id>` node's text is dropped, with its position
  // carried into the live node's overlay if no overlay exists. That
  // gives us the visible swap on the user's next canvas refresh
  // (which Pusher triggers within ~300ms of `save_research`
  // returning) and self-heals the persisted blob on the next
  // autosave. No client-side queue, no race conditions, no phantom
  // nodes.
  //
  // The only client-side work is firing the kickoff. Tracking which
  // authored node ids we've already kicked off prevents a double-fire
  // if the user hits Enter twice on the same node before the swap
  // happens.

  /**
   * Authored research node ids whose kickoff we've already fired.
   * The library prefills new nodes with placeholder text ("New
   * node") rather than an empty string, so we can't use
   * "empty→non-empty" as the trigger. Instead: fire the kickoff the
   * first time the user-typed text differs from whatever was there
   * before AND we haven't already fired for this id.
   */
  const firedResearchKickoffsRef = useRef<Set<string>>(new Set());

  const sendCanvasChatMessage = useSendCanvasChatMessage();

  /**
   * Fire the synthetic user message that drives the agent.
   *
   * The store's `activeConversationId` may legitimately be null for a
   * brief window during initial mount (before `OrgCanvasView` calls
   * `startConversation`). In that case we drop the kickoff silently
   * — the user can hit Enter again once the chat is ready, or just
   * type the request directly. We don't want to retry-loop the
   * kickoff because that'd race with the user editing the node.
   */
  const fireResearchKickoff = useCallback(
    (topic: string) => {
      const trimmedTopic = topic.trim();
      if (!trimmedTopic) return;
      const conversationId =
        useCanvasChatStore.getState().activeConversationId;
      if (!conversationId) {
        console.warn(
          "[OrgCanvasBackground] research kickoff fired before chat conversation was ready; user will need to retry or type the request manually",
        );
        return;
      }
      // Format that the prompt suffix instructs the agent to recognize
      // ("if you see a synthetic user message of the form 'Research:
      // <topic>', that's the signal"). The agent extracts the topic
      // and is told to pass it as `topic` verbatim into save_research,
      // which is what makes the IO-layer text-equality dedupe work.
      void sendCanvasChatMessage({
        conversationId,
        content: `Research: ${trimmedTopic}`,
      });
    },
    [sendCanvasChatMessage],
  );

  /**
   * Open the InitiativeDialog with the click position cached. Caller
   * passes the synthetic node from the library so we can pull `x`/`y`
   * off it.
   */
  const startInitiativeCreate = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      setPendingAdd({
        kind: "initiative",
        x: node.x,
        y: node.y,
        canvasRef,
      });
    },
    [],
  );

  /**
   * Open the MilestoneDialog. Pre-fetch the initiative's existing
   * milestones so we know which sequence numbers are taken (needed
   * for the dialog's client-side validation) and what the next-free
   * sequence is to pre-populate the form.
   *
   * Caller (handleNodeAdd) must already have validated the scope —
   * this function trusts that `canvasRef` is `initiative:<id>`.
   */
  const startMilestoneCreate = useCallback(
    async (node: CanvasNode, canvasRef: string) => {
      const initiativeId = canvasRef.slice("initiative:".length);
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones`,
        );
        const data = res.ok ? await res.json() : null;
        const defaultSequence = data ? data.count + 1 : undefined;
        setPendingAdd({
          kind: "milestone",
          x: node.x,
          y: node.y,
          canvasRef,
          initiativeId,
          defaultSequence,
        });
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] failed to fetch milestones for dialog seed",
          err,
        );
        setPendingAdd({
          kind: "milestone",
          x: node.x,
          y: node.y,
          canvasRef,
          initiativeId,
          defaultSequence: undefined,
        });
      }
    },
    [githubLogin],
  );

  /**
   * Open the CreateFeatureCanvasDialog. Unlike initiative/milestone
   * dialogs, feature creation has no scope-bound pre-fetch: the dialog
   * itself loads workspaces / initiatives / edge hints lazily on open.
   * The caller passes `prefill` only when this is a promote-from-note
   * path (so the dialog seeds its title + description).
   */
  const startFeatureCreate = useCallback(
    (
      node: CanvasNode,
      canvasRef: string | undefined,
      prefill?: { title?: string; brief?: string },
      sourceNoteId?: string,
    ) => {
      setPendingAdd({
        kind: "feature",
        x: node.x,
        y: node.y,
        canvasRef,
        prefill,
        sourceNoteId,
      });
    },
    [],
  );

  /**
   * Open the CreateServiceCanvasDialog. Service is authored-only (no
   * DB row), so this just stashes the lib-synthesized node and waits
   * for the dialog to fill in name + platform `kind` — at which point
   * `handleSaveService` writes the node to the canvas blob via
   * `applyMutation`. Caller (handleNodeAdd) must have validated scope.
   */
  const startServiceCreate = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      setPendingAdd({ kind: "service", node, canvasRef });
    },
    [],
  );

  const handleNodeAdd = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      // Live-node re-add — fired by the library's undo when reversing a
      // hide. Add the node back locally for instant display, then tell the
      // server to un-hide it so the projector picks it up on next fetch.
      if (isLiveId(node.id)) {
        applyMutation(canvasRef, (c) => addNode(c, node));
        void toggleLiveVisibility(githubLogin, canvasRef, node.id, "show").then(
          () => {
            if (!canvasRef) {
              refreshRootHiddenLive();
            } else if (canvasRef === currentRefRef.current) {
              refreshHiddenLive();
            }
          },
        );
        return;
      }

      const category = node.category ?? "";
      const ref = canvasRef ?? "";

      // DB-creating categories are routed through their dialog. The
      // scope-aware `+` menu filter shouldn't have offered the option
      // outside its valid scope, but check here too — a stale menu
      // pick (e.g. user navigated mid-click) shouldn't create at the
      // wrong scope. Single rule, two enforcement points.
      if (DB_CREATING_CATEGORIES.has(category)) {
        if (!categoryAllowedOnScope(category, ref)) return;
        if (category === "initiative") {
          startInitiativeCreate(node, canvasRef);
          return;
        }
        if (category === "milestone") {
          // categoryAllowedOnScope guarantees ref starts with "initiative:".
          void startMilestoneCreate(node, ref);
          return;
        }
        if (category === "feature") {
          // Allowed on every scope per `categoryAllowedOnScope`. The
          // dialog handles per-scope field locking; we just hand off
          // the click position.
          startFeatureCreate(node, canvasRef);
          return;
        }
      }

      // Service is authored-only (no DB row, no projector) but still
      // routes through a dialog so the user picks a platform icon up
      // front. We don't add it to DB_CREATING_CATEGORIES — that set's
      // semantic is "needs a REST POST"; service skips the API entirely
      // and lands in the canvas blob via `applyMutation` once the dialog
      // returns. Still scope-guarded against a stale menu pick.
      if (category === "service") {
        if (!categoryAllowedOnScope(category, ref)) return;
        startServiceCreate(node, canvasRef);
        return;
      }

      applyMutation(canvasRef, (c) => addNode(c, node));
    },
    [
      applyMutation,
      githubLogin,
      refreshHiddenLive,
      refreshRootHiddenLive,
      startInitiativeCreate,
      startMilestoneCreate,
      startFeatureCreate,
      startServiceCreate,
    ],
  );

  // -------------------------------------------------------------------
  // Dialog save handlers
  // -------------------------------------------------------------------

  const handleSaveInitiative = useCallback(
    async (form: InitiativeForm): Promise<void> => {
      if (pendingAdd?.kind !== "initiative") return;
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        targetDate: form.targetDate || undefined,
        completedAt: form.completedAt || undefined,
      };
      const res = await fetch(`/api/orgs/${githubLogin}/initiatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Surface enough info to console; the dialog's `onSave` swallows
        // the throw so this is the user-visible signal we have today.
        // A toast belongs here when we add the global toast system.
        console.error(
          "[OrgCanvasBackground] create initiative failed",
          res.status,
        );
        toast.error("Failed to create initiative");
        return;
      }
      const created: InitiativeResponse = await res.json();
      // Pin the new initiative to the click position before refetching
      // so the refetched canvas already has the position overlay
      // applied. If the position write fails, the projector falls back
      // to default placement and the user can drag.
      await savePositionForLiveId(
        pendingAdd.canvasRef,
        `initiative:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      // Local refetch: don't wait for the Pusher fan-out (300ms delay
      // + WebSocket round-trip + dirtyRef guard). The user just took
      // an explicit action; the new card should appear immediately.
      // Pusher still handles other tabs / users.
      try {
        const data = await fetchRoot(githubLogin);
        setRoot(data);
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create initiative failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  const handleSaveMilestone = useCallback(
    async (form: MilestoneForm): Promise<{ error?: string }> => {
      if (pendingAdd?.kind !== "milestone") return {};
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        status: form.status,
        sequence: parseInt(form.sequence, 10),
        dueDate: form.dueDate || undefined,
        completedAt: form.completedAt || undefined,
      };
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${pendingAdd.initiativeId}/milestones`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 409) {
        return {
          error:
            "A milestone with that sequence already exists in this initiative.",
        };
      }
      if (!res.ok) {
        return { error: "Failed to create milestone." };
      }
      const created: MilestoneResponse = await res.json();
      // Same pattern as initiative create: position-save first so the
      // refetch already reflects it, then refresh the timeline locally
      // for snappy UX. Pusher still notifies other tabs.
      const subRef = pendingAdd.canvasRef;
      await savePositionForLiveId(
        subRef,
        `milestone:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      try {
        const data = await fetchSub(githubLogin, subRef);
        setSubCanvases((prev) => ({ ...prev, [subRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create milestone failed",
          err,
        );
      }
      return {};
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  /**
   * Save handler for the CreateFeatureCanvasDialog. Hits POST
   * /api/features with the resolved `(workspaceId, initiativeId,
   * milestoneId)` triple, then routes the click-position save and
   * canvas refetch to the **target** canvas — which is the most
   * specific scope the new feature lives on, NOT the canvas the user
   * triggered from. Example: user creates from root and picks an
   * initiative → the new feature card appears on the initiative's
   * sub-canvas, so we save the position there and refetch that
   * sub-canvas (not root).
   *
   * If the dialog was opened via "Promote to Feature" on a note,
   * `pendingAdd.sourceNoteId` is set and we remove that note from the
   * originating canvas after the feature is created — the user
   * "consumed" the note when they promoted it.
   */
  const handleSaveFeature = useCallback(
    async (form: FeatureCreateForm): Promise<void> => {
      if (pendingAdd?.kind !== "feature") return;
      const body: Record<string, unknown> = {
        title: form.title,
        workspaceId: form.workspaceId,
        ...(form.brief ? { brief: form.brief } : {}),
        ...(form.initiativeId ? { initiativeId: form.initiativeId } : {}),
        ...(form.milestoneId ? { milestoneId: form.milestoneId } : {}),
      };
      const res = await fetch(`/api/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Surface enough info to console; toast lands here when the
        // global toast system arrives (same gap as initiative/milestone).
        const detail = await res.text().catch(() => "");
        console.error(
          "[OrgCanvasBackground] create feature failed",
          res.status,
          detail,
        );
        toast.error("Failed to create feature");
        return;
      }
      const payload = await res.json();
      const created: { id: string } = payload?.data ?? payload;

      // Resolve the target canvas ref by the "most specific place
      // wins" rule. This must mirror the projector emission rules:
      //   - initiativeId set (with or without milestoneId) → initiative:<id>
      //   - neither set                                    → ws:<id>
      // Milestone-bound features render on their parent initiative's
      // canvas (with a synthetic edge to the milestone card on the
      // same canvas) — there is no separate milestone canvas. Mismatch
      // here would save the position overlay on the wrong canvas, the
      // projected node would render at the projector default, and the
      // user's click position would silently vanish.
      const targetRef: string = form.initiativeId
        ? `initiative:${form.initiativeId}`
        : `ws:${form.workspaceId}`;

      // Save the click position before refetching so the position
      // overlay is already in the blob by the time the canvas reads.
      // Note we pass the **target** ref, not the source canvas ref —
      // the position lives on the canvas the feature renders on.
      await savePositionForLiveId(
        targetRef,
        `feature:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );

      // Promote-from-note path: remove the source note. We do this
      // through the same `applyMutation` flow as a regular delete so
      // the autosave + Pusher broadcast follow the standard path.
      if (pendingAdd.sourceNoteId) {
        applyMutation(pendingAdd.canvasRef, (c) =>
          removeNode(c, pendingAdd.sourceNoteId!),
        );
      }

      // Local refetch of the **target** canvas so the new feature
      // shows up immediately. If the target is the same canvas the
      // user is on, this is the natural refresh; if it's elsewhere
      // (e.g. created on root, lands on initiative), the user will
      // see the card on first drill-in. Pusher fan-out handles other
      // tabs/users.
      try {
        if (targetRef === "") {
          // Defensive: today no feature lands on root (the matrix
          // above always picks a sub-canvas), but keep this branch
          // so the code stays correct if the rules expand.
          const data = await fetchRoot(githubLogin);
          setRoot(data);
        } else {
          const data = await fetchSub(githubLogin, targetRef);
          setSubCanvases((prev) => ({ ...prev, [targetRef]: data }));
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create feature failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId, applyMutation],
  );

  /**
   * Save handler for `CreateServiceCanvasDialog`. Pure canvas-blob write
   * — no REST POST, no projector. We take the lib-synthesized node we
   * stashed in `pendingAdd.node`, merge in the dialog's `name` (as
   * `text`) and `kind` (as `customData.kind`), and drop the result into
   * the canvas blob via `applyMutation`. The click position the lib
   * gave us is already on `node.x` / `node.y` so the card lands where
   * the user clicked.
   *
   * No projector means no Pusher fan-out — the local `applyMutation`
   * is the only state update needed. Other tabs/users see the new
   * service on their next canvas read (or via autosave's mirror to
   * `Canvas.data`).
   */
  const handleSaveService = useCallback(
    async (form: { name: string; kind: string }): Promise<void> => {
      if (pendingAdd?.kind !== "service") return;
      const { node, canvasRef } = pendingAdd;
      const merged: CanvasNode = {
        ...node,
        text: form.name,
        customData: {
          // Preserve anything the lib synthesized (today there's
          // nothing, but defensive merge so future lib fields survive).
          ...(node.customData ?? {}),
          kind: form.kind,
        },
      };
      applyMutation(canvasRef, (c) => addNode(c, merged));
    },
    [pendingAdd, applyMutation],
  );

  /**
   * Save handler for the CreateFeatureCanvasDialog's **Assign existing**
   * tab. Two flavors driven by the discriminated payload:
   *
   *   - `kind: "workspace-pin"` (workspace canvas) — POST to
   *     `/canvas/assigned-features` with `action: "assign"` to add the
   *     feature id to the canvas's `assignedFeatures` overlay. Feature
   *     row unchanged. Click position lands the card.
   *
   *   - `kind: "initiative-attach"` (initiative canvas) — PATCH
   *     `/api/features/[id]` with `{ initiativeId }` to set the loose
   *     feature's anchor. Service-side `notifyFeatureReassignmentRefresh`
   *     fans out CANVAS_UPDATED to both initiatives (in this case just
   *     the landing one — `before.initiativeId` is null for loose
   *     features). The projector emits the card on this initiative's
   *     canvas alongside its milestones on the next read.
   *
   * Both paths converge on the same `savePositionForLiveId + refetch`
   * tail so the card lands where the user clicked.
   */
  const handleAssignFeature = useCallback(
    async (form: FeatureAssignForm): Promise<void> => {
      if (pendingAdd?.kind !== "feature") return;

      // Resolve `(targetRef, mutationFetch)` per flavor. `targetRef`
      // is always the canvas the user is currently on — exactly the
      // canvas the new card should appear on, since both flavors
      // re-project onto the source scope after the mutation.
      let targetRef: string;
      let mutationFetch: () => Promise<Response>;

      if (form.kind === "workspace-pin") {
        targetRef = `ws:${form.workspaceId}`;
        // Defensive: the dialog only surfaces the workspace-pin
        // payload when the pending scope is the matching workspace
        // canvas. Bail out instead of silently writing to the wrong
        // canvas if it doesn't.
        if (pendingAdd.canvasRef !== targetRef) {
          console.error(
            "[OrgCanvasBackground] handleAssignFeature canvasRef mismatch (workspace)",
            { pendingRef: pendingAdd.canvasRef, targetRef },
          );
          return;
        }
        mutationFetch = () =>
          fetch(`/api/orgs/${githubLogin}/canvas/assigned-features`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ref: targetRef,
              featureId: form.featureId,
              action: "assign",
            }),
          });
      } else {
        targetRef = `initiative:${form.initiativeId}`;
        if (pendingAdd.canvasRef !== targetRef) {
          console.error(
            "[OrgCanvasBackground] handleAssignFeature canvasRef mismatch (initiative)",
            { pendingRef: pendingAdd.canvasRef, targetRef },
          );
          return;
        }
        mutationFetch = () =>
          fetch(`/api/features/${form.featureId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initiativeId: form.initiativeId }),
          });
      }

      const res = await mutationFetch();
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(
          "[OrgCanvasBackground] assign feature failed",
          form.kind,
          res.status,
          detail,
        );
        toast.error("Failed to assign feature");
        return;
      }

      await savePositionForLiveId(
        targetRef,
        `feature:${form.featureId}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      try {
        const data = await fetchSub(githubLogin, targetRef);
        setSubCanvases((prev) => ({ ...prev, [targetRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after assign feature failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  /**
   * Persist a milestone status change to the DB. Fire-and-forget; on
   * success the API route emits CANVAS_UPDATED which round-trips through
   * the projector and reconciles the canonical status. On failure, log
   * and let the next read pull the unchanged status — the optimistic
   * local change will be quietly reverted, which is acceptable for the
   * "I clicked the wrong swatch" scenario.
   */
  const persistMilestoneStatus = useCallback(
    async (
      milestoneId: string,
      initiativeId: string,
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED",
    ) => {
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          console.error(
            `[OrgCanvasBackground] PATCH milestone status failed (${res.status})`,
          );
          toast.error("Failed to update milestone status");
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] PATCH milestone status threw",
          err,
        );
        toast.error("Failed to update milestone status");
      }
    },
    [githubLogin],
  );

  const persistMilestoneName = useCallback(
    async (milestoneId: string, initiativeId: string, name: string) => {
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          },
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] PATCH milestone name failed",
            res.status,
            detail,
          );
          toast.error("Failed to rename milestone");
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] PATCH milestone name threw",
          err,
        );
        toast.error("Failed to rename milestone");
      }
    },
    [githubLogin],
  );

  /**
   * Persist a feature title rename to the DB. Same fire-and-forget
   * shape as `persistMilestoneStatus`: optimistic local update lands
   * via `applyMutation`, then the PATCH round-trips through the API
   * route → projector → Pusher CANVAS_UPDATED, which reconciles to
   * the canonical `Feature.title`. On failure, log and let the next
   * read snap the card back to the prior title.
   *
   * Trim happens server-side too (`updateFeature`), but we trim here
   * to skip the network call when the user typed only whitespace.
   */
  const persistFeatureTitle = useCallback(
    async (featureId: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] PATCH feature title failed",
            res.status,
            detail,
          );
          toast.error("Failed to rename feature");
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] PATCH feature title threw", err);
        toast.error("Failed to rename feature");
      }
    },
    [],
  );

  const handleNodeUpdate = useCallback(
    (id: string, patch: NodeUpdate, canvasRef: string | undefined) => {
      // Snapshot the pre-update node BEFORE we apply the mutation. The
      // research-kickoff branch below needs to see whether the text
      // just transitioned empty→non-empty, which requires the prior
      // value. `applyMutation` reads from refs that lag React state
      // by a render anyway, so reading them here is consistent with
      // what the mutation will see.
      const sourceCanvas = canvasRef
        ? subCanvasesRef.current[canvasRef]
        : rootRef.current;
      const prevNode = sourceCanvas?.nodes?.find((n) => n.id === id);

      // Optimistic local update first — keeps the swatch reflecting the
      // user's choice immediately, regardless of which path we take
      // below. The autosave will silently drop customData on live ids
      // (the splitter discards it), so this never round-trips through
      // the canvas blob — the PATCH below is the only persistence path
      // for status.
      applyMutation(canvasRef, (c) => updateNode(c, id, patch));

      // For milestone live nodes: a status change is a DB mutation, not
      // a canvas blob change. Intercept it here and PATCH the milestone
      // REST endpoint. Position changes (x/y) still flow through the
      // normal autosave path as `positions[liveId]` overlays.
      if (
        id.startsWith("milestone:") &&
        canvasRef?.startsWith("initiative:")
      ) {
        const newStatus = patch.customData?.status;
        if (
          newStatus === "NOT_STARTED" ||
          newStatus === "IN_PROGRESS" ||
          newStatus === "COMPLETED"
        ) {
          const milestoneId = id.slice("milestone:".length);
          const initiativeId = canvasRef.slice("initiative:".length);
          void persistMilestoneStatus(milestoneId, initiativeId, newStatus);
        }
      }

      // For feature live nodes: a text edit is a DB title rename, not
      // a canvas blob change. The splitter drops `text` on live ids
      // (see `src/lib/canvas/io.ts`), so without this intercept the
      // user's edit reverts on the next read. Skip when the text
      // didn't actually change to avoid spurious PATCHes from
      // re-renders.
      if (id.startsWith("feature:") && patch.text !== undefined) {
        const prevText = (prevNode?.text ?? "").trim();
        const nextText = patch.text.trim();
        if (nextText.length > 0 && nextText !== prevText) {
          const featureId = id.slice("feature:".length);
          void persistFeatureTitle(featureId, nextText);
        }
      }

      // For milestone live nodes: a text edit is a DB name rename, not
      // a canvas blob change. The splitter drops `text` on live ids
      // (see `src/lib/canvas/io.ts`), so without this intercept the
      // user's edit reverts on the next read. Skip when the text
      // didn't actually change to avoid spurious PATCHes.
      if (id.startsWith("milestone:") && patch.text !== undefined) {
        const prevText = (prevNode?.text ?? "").trim();
        const nextText = patch.text.trim();
        if (
          nextText.length > 0 &&
          nextText !== prevText &&
          canvasRef?.startsWith("initiative:")
        ) {
          const milestoneId = id.slice("milestone:".length);
          const initiativeId = canvasRef.slice("initiative:".length);
          void persistMilestoneName(milestoneId, initiativeId, nextText);
        }
      }

      // Research kickoff trigger. When an authored research node's
      // text gets edited for the first time, fire the chat-side
      // kickoff that drives `save_research`. Authored = no
      // `research:` id prefix; that prefix only appears once the
      // projector emits the live node post-save. The authored
      // placeholder gets dropped automatically once the live node
      // arrives — the dedupe runs in `dedupeAuthoredResearch`
      // (`src/lib/canvas/io.ts`) on every read AND every write.
      //
      // The trigger isn't "empty→non-empty" because the library
      // prefills new nodes with placeholder text like "New node"
      // instead of "". Instead, we fire on the FIRST text edit per
      // authored node id (tracked in `firedResearchKickoffsRef`),
      // skipping spurious updates where text didn't actually change.
      if (
        prevNode &&
        prevNode.category === "research" &&
        !id.startsWith("research:") &&
        patch.text !== undefined &&
        !firedResearchKickoffsRef.current.has(id)
      ) {
        const prevText = (prevNode.text ?? "").trim();
        const nextText = patch.text.trim();
        if (nextText.length > 0 && nextText !== prevText) {
          firedResearchKickoffsRef.current.add(id);
          fireResearchKickoff(nextText);
        }
      }
    },
    [
      applyMutation,
      fireResearchKickoff,
      persistMilestoneStatus,
      persistMilestoneName,
      persistFeatureTitle,
    ],
  );

  /**
   * Batched drag commit. Fires once per drag-end with every moved node
   * — for a single-node drag that's a one-entry array; for a group
   * drag it's the group plus every spatially-contained child.
   *
   * Why this exists: `applyMutation` reads `rootRef.current` /
   * `subCanvasesRef.current`, both mirrored from React state via
   * `useEffect`. The mirror runs *after* React commits, so a synchronous
   * loop of per-node `onNodeUpdate` calls all read the same stale
   * starting state and each `setRoot` overwrites the previous one. The
   * visible bug: dragging a group leaves every child snapping back
   * except the last one in the iteration order. Folding all moves
   * into a single `applyMutation` (which chains every patch through
   * `updateNode` against one starting state) commits the group
   * atomically.
   *
   * The drag path never carries `customData` — only x/y — so we can
   * skip the milestone status special case here. Toolbar status
   * changes still come through `onNodeUpdate` as before.
   */
  const handleNodesUpdate = useCallback(
    (
      updates: { id: string; patch: NodeUpdate }[],
      canvasRef: string | undefined,
    ) => {
      if (updates.length === 0) return;
      applyMutation(canvasRef, (c) =>
        updates.reduce((acc, u) => updateNode(acc, u.id, u.patch), c),
      );
    },
    [applyMutation],
  );

  const handleNodeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      // Live nodes (workspaces, repos, features) aren't deletable — they
      // belong to the DB. "Delete" on the canvas means "hide on this
      // view." Route to the dedicated endpoint, and optimistically drop
      // the node from local state so the UI reacts immediately. The
      // endpoint is idempotent, so a race with a concurrent hide is
      // harmless.
      if (isLiveId(id)) {
        applyMutation(canvasRef, (c) => removeNode(c, id));
        void toggleLiveVisibility(githubLogin, canvasRef, id, "hide").then(
          () => {
            if (!canvasRef) {
              refreshRootHiddenLive();
            } else if (canvasRef === currentRefRef.current) {
              refreshHiddenLive();
            }
          },
        );
        return;
      }
      applyMutation(canvasRef, (c) => removeNode(c, id));
    },
    [applyMutation, githubLogin, refreshHiddenLive, refreshRootHiddenLive],
  );

  const handleNodesDelete = useCallback(
    (ids: string[], canvasRef: string | undefined) => {
      if (ids.length === 0) return;

      const liveIds = ids.filter(isLiveId);

      applyMutation(canvasRef, (c) =>
        ids.reduce((acc, id) => removeNode(acc, id), c),
      );

      for (const id of liveIds) {
        void toggleLiveVisibility(githubLogin, canvasRef, id, "hide").then(
          () => {
            if (!canvasRef) {
              refreshRootHiddenLive();
            } else if (canvasRef === currentRefRef.current) {
              refreshHiddenLive();
            }
          },
        );
      }
    },
    [applyMutation, githubLogin, refreshHiddenLive, refreshRootHiddenLive],
  );

  return {
    pendingAdd,
    setPendingAdd,
    startFeatureCreate,
    handleNodeAdd,
    handleNodeUpdate,
    handleNodesUpdate,
    handleNodeDelete,
    handleNodesDelete,
    handleSaveInitiative,
    handleSaveMilestone,
    handleSaveFeature,
    handleSaveService,
    handleAssignFeature,
  };
}
