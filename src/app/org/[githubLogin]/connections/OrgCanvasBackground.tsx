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

/**
 * Live-id detection mirrors `src/lib/canvas/scope.ts`'s `isLiveId`.
 * Duplicated here because that module is server-side (pulls Prisma); we
 * only need the prefix check on the client. Keep the prefix list in sync
 * with `LIVE_ID_PREFIXES` there.
 */
const LIVE_ID_PREFIXES = ["ws:", "feature:", "repo:"];
function isLiveId(id: string): boolean {
  return LIVE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Categories projected from the DB — the agent can't author them and
 * the user shouldn't either (any node they'd create would be a fake
 * that vanishes on refresh). Filtered out of the `+` menu below.
 */
const PROJECTED_CATEGORIES = new Set(["workspace", "repository"]);

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

  const handleNodeAdd = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => addNode(c, node));
    },
    [applyMutation],
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
   * We also filter out projected categories (`workspace`, `repository`)
   * from the menu — authoring those would create ghost nodes that
   * vanish on the next read. Restore-from-hidden lives on its own pill
   * (see `HiddenLivePill`); creating a real workspace happens through
   * the normal workspace-creation UI.
   */
  const renderAddNodeButton = (props: AddNodeButtonRenderProps) => {
    const filtered = {
      ...props,
      options: props.options.filter(
        (o) => !(o.kind === "category" && PROJECTED_CATEGORIES.has(o.value)),
      ),
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
    </>
  );
}
