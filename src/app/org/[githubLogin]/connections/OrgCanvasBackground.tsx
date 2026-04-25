"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddNodeButton,
  SystemCanvas,
  addEdge,
  addNode,
  removeEdge,
  removeNode,
  updateEdge,
  updateNode,
  type AddNodeButtonRenderProps,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type EdgeUpdate,
  type NodeUpdate,
} from "system-canvas-react";
import { connectionsTheme } from "./canvas-theme";
import { HiddenLivePill, type HiddenLiveEntry } from "./HiddenLivePill";
import { getOrgChannelName, getPusherClient, PUSHER_EVENTS } from "@/lib/pusher";
import {
  InitiativeDialog,
  type InitiativeForm,
} from "@/components/initiatives/InitiativeDialog";
import {
  MilestoneDialog,
  type MilestoneForm,
} from "@/components/initiatives/MilestoneDialog";
import type {
  InitiativeResponse,
  MilestoneResponse,
} from "@/types/initiatives";

/**
 * Live-id detection mirrors `src/lib/canvas/scope.ts`'s `isLiveId`.
 * Duplicated here because that module is server-side (pulls Prisma); we
 * only need the prefix check on the client. Keep the prefix list in sync
 * with `LIVE_ID_PREFIXES` there.
 */
const LIVE_ID_PREFIXES = ["ws:", "feature:", "repo:", "initiative:", "milestone:"];
function isLiveId(id: string): boolean {
  return LIVE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Categories that should NOT appear in the user's `+` menu. Workspaces
 * and repositories come from external integrations (workspace creation
 * flow, GitHub sync) — they're not creatable from the canvas. Anything
 * else stays in the menu.
 *
 * Note that `initiative` and `milestone` are **kept in the menu** even
 * though they're DB-projected: selecting them triggers the dialog
 * interception below, which opens a creation dialog and POSTs to the
 * REST API. See `handleNodeAdd`.
 */
const NON_USER_CREATABLE_CATEGORIES = new Set(["workspace", "repository"]);

/**
 * Categories that, when picked from the `+` menu, open a creation
 * dialog instead of dropping a node onto the canvas. The dialog hits
 * the appropriate REST API; on success the projector re-emits the new
 * node, and we save the user's click position so the node lands where
 * they clicked.
 */
const DB_CREATING_CATEGORIES = new Set(["initiative", "milestone"]);

/**
 * Full-screen interactive system-canvas background for the Connections page.
 *
 * Single-owner state model: this component owns both the root canvas and a
 * `Record<ref, CanvasData>` map of nested sub-canvases. Every editing
 * callback from SystemCanvas arrives with a `canvasRef` (undefined for the
 * root, a string for a sub-canvas) — we route mutations through that key
 * and schedule a per-ref debounced save to our REST endpoints.
 */

const ROOT_KEY = "__root__";
const AUTOSAVE_MS = 600;

type DirtyMap = Map<string, CanvasData>;

async function fetchRoot(githubLogin: string): Promise<CanvasData> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas`);
  if (!res.ok) throw new Error(`Failed to load canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function fetchSub(githubLogin: string, ref: string): Promise<CanvasData> {
  const res = await fetch(
    `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`,
  );
  if (!res.ok) throw new Error(`Failed to load sub-canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function saveCanvas(
  githubLogin: string,
  ref: string | undefined,
  data: CanvasData,
): Promise<void> {
  const url = ref
    ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`
    : `/api/orgs/${githubLogin}/canvas`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    // Best-effort: surface in console but don't throw — we want autosave
    // to keep trying on the next edit rather than get stuck.
    console.error(`[OrgCanvasBackground] PUT failed (${res.status})`);
  }
}

/**
 * Toggle the visibility of a projected live node. Routed through the
 * dedicated `/canvas/hide` endpoint so it can't be clobbered by the
 * autosave PUT (which only writes nodes + positions).
 */
async function toggleLiveVisibility(
  githubLogin: string,
  ref: string | undefined,
  id: string,
  action: "hide" | "show",
): Promise<void> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: ref ?? "", id, action }),
  });
  if (!res.ok) {
    console.error(
      `[OrgCanvasBackground] ${action} failed for ${id} (${res.status})`,
    );
  }
}

async function fetchHiddenLive(
  githubLogin: string,
  ref: string | undefined,
): Promise<HiddenLiveEntry[]> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide${qs}`);
  if (!res.ok) {
    console.error(
      `[OrgCanvasBackground] fetchHiddenLive failed (${res.status})`,
    );
    return [];
  }
  const body = await res.json();
  return (body.entries ?? []) as HiddenLiveEntry[];
}

interface OrgCanvasBackgroundProps {
  githubLogin: string;
  /**
   * Pixels to inset the canvas from the right edge of the viewport. Used
   * to keep the library's bottom-right "+" FAB from hiding behind the
   * Connections sidebar.
   */
  rightInset?: number;
  /**
   * Label for the root breadcrumb. We prefer the org's display name so
   * users see "Acme" rather than the generic "Canvas"; falls back to
   * the `githubLogin` when no name is set.
   */
  orgName?: string | null;
  /**
   * Fires whenever the hidden-live set for the ROOT canvas changes
   * (initial fetch, user hide/restore, Pusher-driven refetch). Lets the
   * parent keep other surfaces in sync — e.g. excluding hidden
   * workspaces from the chat's default context set.
   *
   * The callback is called with a fresh array every time; don't mutate.
   */
  onHiddenChange?: (entries: HiddenLiveEntry[]) => void;
}

export function OrgCanvasBackground({
  githubLogin,
  rightInset = 0,
  orgName,
  onHiddenChange,
}: OrgCanvasBackgroundProps) {
  const [root, setRoot] = useState<CanvasData | null>(null);
  const [subCanvases, setSubCanvases] = useState<Record<string, CanvasData>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Hidden live entries for the ROOT canvas only. Keeps the pill's
   * data model simple (it sits on the root view). If we later surface
   * hidden entries on sub-canvases, switch this to a `Record<ref, …>`.
   */
  const [hiddenLive, setHiddenLive] = useState<HiddenLiveEntry[]>([]);

  // Keep the latest sub-canvases available to the save flusher without
  // re-creating the debounce timer every render.
  const subCanvasesRef = useRef(subCanvases);
  useEffect(() => {
    subCanvasesRef.current = subCanvases;
  }, [subCanvases]);
  const rootRef = useRef(root);
  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  // Map keyed by ROOT_KEY or sub-canvas ref -> latest data waiting to flush.
  const dirtyRef = useRef<DirtyMap>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      flushTimer.current = null;
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        void saveCanvas(githubLogin, ref, data);
      }
    }, AUTOSAVE_MS);
  }, [githubLogin]);

  const markDirty = useCallback(
    (canvasRef: string | undefined, next: CanvasData) => {
      dirtyRef.current.set(canvasRef ?? ROOT_KEY, next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // Initial root load + hidden-list fetch. Both are root-scoped, both
  // run once per org switch; bundling them here keeps the effect count
  // low and guarantees the pill shows up on first paint (no flash).
  useEffect(() => {
    let cancelled = false;
    fetchRoot(githubLogin)
      .then((data) => {
        if (!cancelled) setRoot(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[OrgCanvasBackground] failed to load root", err);
          setLoadError("Failed to load canvas");
        }
      });
    fetchHiddenLive(githubLogin, undefined).then((entries) => {
      if (!cancelled) setHiddenLive(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  const refreshHiddenLive = useCallback(() => {
    fetchHiddenLive(githubLogin, undefined).then(setHiddenLive);
  }, [githubLogin]);

  // Notify the parent whenever the hidden-live set changes. Runs once
  // on mount after the initial fetch resolves, and again on every
  // subsequent toggle. Stable reference guard on `onHiddenChange` so
  // callers that inline a lambda don't cause extra passes.
  useEffect(() => {
    onHiddenChange?.(hiddenLive);
  }, [hiddenLive, onHiddenChange]);

  // Flush any pending saves on unmount so we don't lose the last edit.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        // Fire-and-forget; the tab is gone by the time this resolves but
        // fetch() still sends the request.
        void saveCanvas(githubLogin, ref, data);
      }
    };
  }, [githubLogin]);

  // Listen for agent-driven canvas updates. When the AI agent (or any
  // other tab / user) rewrites the canvas through `update_canvas` /
  // `patch_canvas`, the server emits `CANVAS_UPDATED` on the org channel
  // so every open viewer refetches and re-renders.
  //
  // Important: we skip the refetch if we have unsaved local edits
  // pending — the user's in-flight changes would be silently clobbered
  // by a read of stale remote state. The autosave flush will propagate
  // our edits shortly, and if a collision happens, last-write-wins.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    const channelName = getOrgChannelName(githubLogin);
    const pusher = getPusherClient();
    const channel = pusher.subscribe(channelName);

    // Diagnostic: log the subscription lifecycle so we can tell, in the
    // field, whether an agent-driven update arrived before or after the
    // server confirmed our subscription. (Non-presence channels drop any
    // events published during the pre-confirmation window.)
    const handleSubSucceeded = () => {
      console.log(`[OrgCanvasBackground] subscribed to ${channelName}`);
    };
    const handleSubError = (err: unknown) => {
      console.error(`[OrgCanvasBackground] subscription error on ${channelName}`, err);
    };
    channel.bind("pusher:subscription_succeeded", handleSubSucceeded);
    channel.bind("pusher:subscription_error", handleSubError);

    const handleCanvasUpdated = (payload: { ref?: string | null }) => {
      console.log("[OrgCanvasBackground] CANVAS_UPDATED received", payload);
      // Don't clobber unsaved local edits — our autosave flush will
      // propagate them shortly. On collision, last-write-wins.
      if (dirtyRef.current.size > 0) return;

      const ref = payload?.ref ?? null;
      if (!ref) {
        fetchRoot(githubLogin)
          .then((data) => setRoot(data))
          .catch((err) => {
            console.error(
              "[OrgCanvasBackground] refetch root after CANVAS_UPDATED failed",
              err,
            );
          });
        // Hidden list can shift too (agent hid/unhid a node, another
        // tab toggled it). Cheap call — one row read + Set lookup.
        fetchHiddenLive(githubLogin, undefined).then(setHiddenLive);
        return;
      }
      // Only refetch sub-canvases we've actually opened. The cache is
      // keyed by ref; if the user hasn't drilled in, there's nothing to
      // update and the next `onResolveCanvas` will fetch fresh anyway.
      if (!subCanvasesRef.current[ref]) return;
      fetchSub(githubLogin, ref)
        .then((data) => {
          setSubCanvases((prev) => ({ ...prev, [ref]: data }));
        })
        .catch((err) => {
          console.error(
            "[OrgCanvasBackground] refetch sub after CANVAS_UPDATED failed",
            err,
          );
        });
    };

    channel.bind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
    return () => {
      channel.unbind("pusher:subscription_succeeded", handleSubSucceeded);
      channel.unbind("pusher:subscription_error", handleSubError);
      channel.unbind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
      pusher.unsubscribe(channelName);
    };
  }, [githubLogin]);

  // Resolve a sub-canvas ref: serve from cache if present, otherwise fetch.
  const onResolveCanvas = useCallback(
    async (ref: string): Promise<CanvasData> => {
      const cached = subCanvasesRef.current[ref];
      if (cached) return cached;
      const data = await fetchSub(githubLogin, ref);
      setSubCanvases((prev) => ({ ...prev, [ref]: data }));
      return data;
    },
    [githubLogin],
  );

  // ----- Editing helpers -------------------------------------------------
  //
  // We route every mutation to either root state or the sub-canvas map,
  // keyed by `canvasRef` (undefined = root). The system-canvas core helpers
  // do the immutable merge for us, so each handler is essentially:
  //
  //   newData = helper(currentData, args)
  //   setLocal(newData); markDirty(canvasRef, newData);
  //
  // The two branches (root vs sub-canvas) are structurally identical; we
  // factor them through `applyMutation`.

  const applyMutation = useCallback(
    (
      canvasRef: string | undefined,
      mutate: (data: CanvasData) => CanvasData,
    ) => {
      if (!canvasRef) {
        const current = rootRef.current;
        if (!current) return;
        const next = mutate(current);
        setRoot(next);
        markDirty(undefined, next);
        return;
      }
      const current = subCanvasesRef.current[canvasRef];
      if (!current) return;
      const next = mutate(current);
      setSubCanvases((prev) => ({ ...prev, [canvasRef]: next }));
      markDirty(canvasRef, next);
    },
    [markDirty],
  );

  // -------------------------------------------------------------------
  // DB-creating `+` menu interception
  //
  // When the user picks `Initiative` or `Milestone` from the `+` menu,
  // the library hands us a freshly-synthesized authored node. We do
  // NOT add it to the canvas blob. Instead we open the matching
  // creation dialog with the click position cached, hit the REST API
  // on save, then save the click position into `Canvas.data.positions`
  // for the projected node id so the new card lands where the user
  // clicked. The Pusher `CANVAS_UPDATED` event from the API then
  // re-projects the new entity onto the canvas.
  //
  // Cancel: nothing happens. No node was added.
  // -------------------------------------------------------------------

  /**
   * Pending dialog state for an interception. Carries the click
   * position so we can save it once the API returns the new entity id.
   * `canvasRef` tracks which canvas the click came from — root for
   * initiatives, `initiative:<id>` for milestones.
   */
  type PendingInitiativeAdd = {
    kind: "initiative";
    x: number;
    y: number;
    canvasRef: string | undefined;
  };
  type PendingMilestoneAdd = {
    kind: "milestone";
    x: number;
    y: number;
    /** Always an `initiative:<id>` ref — milestones can only be added inside one. */
    canvasRef: string;
    initiativeId: string;
    /** Sequence numbers already taken on this initiative; pre-fetched for the dialog. */
    usedSequences: number[];
    defaultSequence: number;
  };
  type PendingAdd = PendingInitiativeAdd | PendingMilestoneAdd;

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
   */
  const startMilestoneCreate = useCallback(
    async (node: CanvasNode, canvasRef: string | undefined) => {
      if (!canvasRef || !canvasRef.startsWith("initiative:")) {
        // Defensive: milestone is only valid on an initiative sub-canvas.
        // The renderer should never offer it elsewhere (we filter the
        // menu by scope in renderAddNodeButton), but if it slips through
        // we just no-op rather than crash.
        return;
      }
      const initiativeId = canvasRef.slice("initiative:".length);
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones`,
        );
        const list: MilestoneResponse[] = res.ok ? await res.json() : [];
        const usedSequences = list.map((m) => m.sequence);
        const defaultSequence =
          usedSequences.length === 0 ? 1 : Math.max(...usedSequences) + 1;
        setPendingAdd({
          kind: "milestone",
          x: node.x,
          y: node.y,
          canvasRef,
          initiativeId,
          usedSequences,
          defaultSequence,
        });
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] failed to fetch milestones for dialog seed",
          err,
        );
      }
    },
    [githubLogin],
  );

  const handleNodeAdd = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      // Intercept DB-creating categories: open a dialog instead of
      // dropping a synthetic authored node. The Pusher refresh from
      // the API mutation will re-project the new entity into place.
      if (DB_CREATING_CATEGORIES.has(node.category ?? "")) {
        if (node.category === "initiative") {
          startInitiativeCreate(node, canvasRef);
          return;
        }
        if (node.category === "milestone") {
          void startMilestoneCreate(node, canvasRef);
          return;
        }
      }
      applyMutation(canvasRef, (c) => addNode(c, node));
    },
    [applyMutation, startInitiativeCreate, startMilestoneCreate],
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
  const handleNodeUpdate = useCallback(
    (id: string, patch: NodeUpdate, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => updateNode(c, id, patch));
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
            if (!canvasRef) refreshHiddenLive();
          },
        );
        return;
      }
      applyMutation(canvasRef, (c) => removeNode(c, id));
    },
    [applyMutation, githubLogin, refreshHiddenLive],
  );

  /**
   * Restore a hidden workspace. Fire-and-forget the server call, then
   * refetch the root canvas so the newly-unhidden live node gets its
   * full projection (name, ref, rollups) rather than the stub we have
   * in `hiddenLive`. Cheap and keeps the pill's state model tiny.
   */
  const handleRestoreLive = useCallback(
    async (id: string) => {
      // Optimistic: remove from the pill immediately so users don't
      // wait on a round-trip before the popover reflects their click.
      setHiddenLive((prev) => prev.filter((e) => e.id !== id));
      await toggleLiveVisibility(githubLogin, undefined, id, "show");
      // Refetch root to pick up the now-visible projected node. The
      // hidden-list refetch is implicit: we already removed it locally.
      try {
        const data = await fetchRoot(githubLogin);
        setRoot(data);
      } catch (err) {
        console.error("[OrgCanvasBackground] refetch after restore failed", err);
        // Reconcile the pill if the refetch dropped out — the server's
        // current state is the source of truth.
        refreshHiddenLive();
      }
    },
    [githubLogin, refreshHiddenLive],
  );
  const handleEdgeAdd = useCallback(
    (edge: CanvasEdge, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => addEdge(c, edge));
    },
    [applyMutation],
  );
  const handleEdgeUpdate = useCallback(
    (id: string, patch: EdgeUpdate, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => updateEdge(c, id, patch));
    },
    [applyMutation],
  );
  const handleEdgeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => removeEdge(c, id));
    },
    [applyMutation],
  );

  const canvasForRender = useMemo<CanvasData>(
    () => root ?? { nodes: [], edges: [] },
    [root],
  );

  // Anchor the canvas container to the viewport but leave `rightInset`
  // pixels of empty space on the right so the library-owned FAB + future
  // toolbar affordances sit to the LEFT of the sidebar. The background
  // color still paints the full inset area (via a separate div) so the
  // sidebar doesn't reveal the page background underneath.
  const canvasContainerStyle: React.CSSProperties = {
    right: rightInset,
  };

  /**
   * Replace the library's default FAB container so we can hoist the
   * button above the chat-input bar. The library would otherwise place it
   * at `bottom:16` of the canvas, which sits underneath the chat input's
   * `pointer-events-auto` wrapper and can't receive clicks.
   *
   * Menu filtering removes only categories the user can never create
   * from the canvas — workspaces and repositories. Initiatives and
   * milestones stay in the menu regardless of current scope; if the
   * user picks `milestone` while on root (where it has no target), the
   * defensive guard in `startMilestoneCreate` no-ops. A future
   * iteration can scope-filter the menu once the library exposes the
   * current ref to this render hook.
   */
  const renderAddNodeButton = (props: AddNodeButtonRenderProps) => {
    const filtered = {
      ...props,
      options: props.options.filter((o) => {
        if (o.kind !== "category") return true;
        return !NON_USER_CREATABLE_CATEGORIES.has(o.value);
      }),
    };
    return (
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 30,
          pointerEvents: "auto",
        }}
      >
        {/*
         * `AddNodeButton` itself is `position:absolute; bottom:16; right:16`,
         * so wrapping it in a `position:relative` shim neutralizes the
         * library's absolute coords and lets our outer wrapper control the
         * final on-screen position.
         */}
        <div style={{ position: "relative" }}>
          <AddNodeButton {...filtered} />
        </div>
      </div>
    );
  };

  if (loadError) {
    // Fail quiet: the canvas is a background; if it can't load, fall back
    // to a plain dark surface rather than blocking the page.
    return <div className="absolute inset-0 bg-[#15171c]" aria-hidden />;
  }

  if (!root) {
    return <div className="absolute inset-0 bg-[#15171c]" aria-hidden />;
  }

  return (
    <>
      <div className="absolute inset-0 bg-[#15171c]" aria-hidden />
      <div className="absolute inset-y-0 left-0" style={canvasContainerStyle}>
        <SystemCanvas
          canvas={canvasForRender}
          canvases={subCanvases}
          theme={connectionsTheme}
          editable
          onResolveCanvas={onResolveCanvas}
          onNodeAdd={handleNodeAdd}
          onNodeUpdate={handleNodeUpdate}
          onNodeDelete={handleNodeDelete}
          onEdgeAdd={handleEdgeAdd}
          onEdgeUpdate={handleEdgeUpdate}
          onEdgeDelete={handleEdgeDelete}
          renderAddNodeButton={renderAddNodeButton}
          rootLabel={orgName || githubLogin}
        />
        {/*
         * Restore pill — top-right of the canvas area. Hides itself
         * when nothing is hidden, so the 99% case is zero chrome. Sits
         * inside the canvas container so it tracks `rightInset`
         * alongside the canvas itself (stays clear of the sidebar).
         */}
        <HiddenLivePill
          entries={hiddenLive}
          onRestore={handleRestoreLive}
        />
      </div>

      {/*
       * Creation dialogs for DB-backed categories. Mounted at the
       * component's top level (not inside the canvas container) so they
       * render as full-page modals rather than getting clipped by the
       * canvas's positioning shim. Closing without saving (cancel,
       * Esc, click-outside) just clears `pendingAdd` — no node was
       * ever added to the canvas.
       */}
      <InitiativeDialog
        open={pendingAdd?.kind === "initiative"}
        onClose={() => setPendingAdd(null)}
        onSave={handleSaveInitiative}
      />
      <MilestoneDialog
        open={pendingAdd?.kind === "milestone"}
        onClose={() => setPendingAdd(null)}
        defaultSequence={
          pendingAdd?.kind === "milestone" ? pendingAdd.defaultSequence : undefined
        }
        usedSequences={
          pendingAdd?.kind === "milestone" ? pendingAdd.usedSequences : []
        }
        onSave={handleSaveMilestone}
      />
    </>
  );
}
