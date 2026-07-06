"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AddNodeButton,
  SystemCanvas,
  type AddNodeButtonRenderProps,
  type BreadcrumbEntry,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSelection,
  type EdgeUpdate,
  type NodeContextMenuConfig,
  type NodeMenuOption,
  type SystemCanvasHandle,
} from "system-canvas-react";
import type {
  CanvasContextMenuConfig,
  CanvasContextMenuItem,
} from "system-canvas";
// `getNodeLabel` isn't re-exported from `system-canvas-react`; pull
// it from the core package directly. Used to resolve human-readable
// labels for edge endpoints at click-time.
import { getNodeLabel } from "system-canvas";
import { connectionsTheme } from "./canvas-theme";
import { HiddenLivePill, type HiddenLiveEntry } from "./HiddenLivePill";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { InitiativeDialog } from "@/components/initiatives/InitiativeDialog";
import { MilestoneDialog } from "@/components/initiatives/MilestoneDialog";
import { CreateFeatureCanvasDialog } from "../_components/CreateFeatureCanvasDialog";
import { CreateServiceCanvasDialog } from "../_components/CreateServiceCanvasDialog";
import { categoryAllowedOnScope, CATEGORY_REGISTRY } from "./canvas-categories";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { useSession } from "next-auth/react";
import { useCanvasCollaboration } from "@/hooks/useCanvasCollaboration";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { computeNodeFocusZoom } from "@/lib/canvas/nodeZoom";
import { isLiveId } from "@/lib/canvas";
import {
  useCanvasPersistence,
  fetchRoot,
  fetchSub,
} from "./useCanvasPersistence";
import { useCanvasHiddenLive } from "./useCanvasHiddenLive";
import { useCanvasEdgeOps } from "./useCanvasEdgeOps";
import { useCanvasNodeOps } from "./useCanvasNodeOps";

/**
 * Full-screen interactive system-canvas background for the Connections page.
 *
 * Single-owner state model: this component owns both the root canvas and a
 * `Record<ref, CanvasData>` map of nested sub-canvases. Every editing
 * callback from SystemCanvas arrives with a `canvasRef` (undefined for the
 * root, a string for a sub-canvas) — we route mutations through that key
 * and schedule a per-ref debounced save to our REST endpoints.
 */


/**
 * Color applied to edges that have a linked Connection doc, so they
 * stand out from un-linked edges at a glance. Theme default is slate-500
 * (`#64748b`); slate-400 (`#94a3b8`) is the "noticeable but quiet"
 * step. Applied as `edge.color` in a render-only decoration pass (see
 * `decorateEdgesWithLinkVisual`); never persisted.
 */
const LINKED_EDGE_COLOR = "#a4b3cc";


/**
 * `CanvasSelection` enriched with the resolved human-readable labels
 * for an edge's endpoints. The lib emits raw `node`/`edge` payloads;
 * we widen the edge case here so consumers (the right panel) don't
 * each have to look up the node map themselves.
 *
 * Node selections pass through unchanged — node entities already
 * carry `text` directly, so consumers that need a label just call
 * `getNodeLabel(selection.node)` themselves.
 */
export interface InternalEdge {
  edge: CanvasEdge;
  fromLabel: string;
  toLabel: string;
}

export type SelectionWithLabels =
  | {
      kind: "node";
      node: CanvasNode;
      canvasRef: string | undefined;
    }
  | {
      kind: "edge";
      edge: CanvasEdge;
      canvasRef: string | undefined;
      fromLabel: string;
      toLabel: string;
    }
  | {
      kind: "multi";
      nodes: CanvasNode[];
      canvasRef: string | undefined;
      internalEdges: InternalEdge[];
    }
  | null;

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
  /**
   * Fires whenever the canvas's selection state changes. Single
   * callback covering all paths: node-click, edge-click,
   * canvas-background-click (deselect), Escape, Delete, navigation,
   * and stale-selection collapse. Mutually exclusive: at most one
   * node or one edge is selected at a time. `null` means nothing.
   *
   * The payload extends the lib's `CanvasSelection` with
   * `fromLabel` / `toLabel` resolved from the canvas data at the
   * moment of selection. Resolving labels here (where the canvas
   * lives) keeps consumers from having to mirror the node map.
   * `getNodeLabel` falls back to the node id when no `text` is set;
   * for live nodes the projector populates `text` with the entity's
   * human name (workspace.name, initiative.name, etc.).
   */
  onSelectionChange?: (selection: SelectionWithLabels) => void;
  /**
   * Imperatively patch an edge's data (today: `customData.connectionId`
   * for the edge\u2194connection link feature). Returns void; the parent
   * doesn't need a result because the canvas state is the source of
   * truth and the next render reflects the change.
   *
   * Wired via a ref so the parent can call it from connection-list
   * affordances (link / unlink) without re-plumbing prop callbacks
   * down to every list row. Set the ref's `.current` to a stable
   * function from this component.
   */
  edgePatchHandleRef?: React.MutableRefObject<
    | ((
        edgeId: string,
        patch: EdgeUpdate,
        canvasRef: string | undefined,
      ) => void)
    | null
  >;
  /**
   * Fires when the user navigates between canvases. Receives a human
   * readable breadcrumb trail joined with ` › ` — e.g. `"Acme"` on
   * root, `"Acme › Auth Refactor"` on a sub-canvas. Used by the chat
   * overlay to tell the agent which scope the user is on by name (the
   * ref id flows separately via `currentCanvasRef`).
   *
   * Today we only nest one level deep, so the trail is always 1 or 2
   * entries. If/when we support multi-level drill-in, we'll need to
   * track the parent stack here — see the TODO in `handleBreadcrumbClick`.
   */
  onCanvasBreadcrumbChange?: (breadcrumb: string) => void;
  /**
   * Fires whenever the set of connection ids referenced by at least
   * one edge (across root + every loaded sub-canvas) changes. The
   * sidebar's connection list uses this to render a small dot on
   * rows whose connection is wired up to the canvas — same idea as
   * the linked-edge color highlight, surfaced from the other side.
   *
   * Emitted as a fresh `Set` each time; consumers can store it
   * directly. Sub-canvases that haven't been loaded yet don't
   * contribute (we only know about edges we've actually fetched),
   * but every sub-canvas the user has visited stays in
   * `subCanvases` for the session, so the set converges as the
   * user explores.
   */
  onLinkedConnectionIdsChange?: (ids: Set<string>) => void;
}

export function OrgCanvasBackground({
  githubLogin,
  rightInset = 0,
  orgName,
  onHiddenChange,
  onSelectionChange,
  edgePatchHandleRef,
  onCanvasBreadcrumbChange,
  onLinkedConnectionIdsChange,
}: OrgCanvasBackgroundProps) {
  const { data: session } = useSession();
  const {
    root,
    setRoot,
    subCanvases,
    setSubCanvases,
    loadError,
    retryLoad,
    rootRef,
    subCanvasesRef,
    dirtyRef,
    applyMutation,
    onResolveCanvas,
    scheduleSave,
  } = useCanvasPersistence({ githubLogin });
  /**
   * Current canvas scope as the user has it open. `""` is root; any
   * non-empty value is a sub-canvas ref (e.g. `"ws:abc"` or
   * `"initiative:xyz"`). Driven by the library's `onNavigate` callback;
   * defaults to root.
   *
   * We track this so chrome that's only meaningful at the org level
   * (notably the "N hidden" restore pill, which lists hidden workspaces)
   * stays out of the way when the user has drilled into a sub-canvas
   * and is focused on a smaller scope.
   */
  const [currentRef, setCurrentRef] = useState<string>("");

  // -------------------------------------------------------------------
  // URL <-> canvas-scope sync
  //
  // The active canvas ref is mirrored to the URL as `?canvas=<ref>` so
  // a user can deep-link into a specific initiative timeline or
  // workspace sub-canvas (e.g. share `?canvas=initiative:abc` with a
  // teammate). Three-way sync:
  //
  //   1. URL → canvas: on mount (and when the URL changes externally),
  //      drill into the ref via `SystemCanvas`'s imperative handle.
  //      Done once after `root` loads — `zoomIntoNode` needs the
  //      target node to exist on the rendered canvas.
  //   2. canvas → URL: `onNavigate(ref)` fires on drill-IN; we replace
  //      the URL with the new ref. Uses `router.replace` so browser
  //      back exits the page rather than walking through canvas
  //      scopes (matches the connections-sidebar URL convention on
  //      the same page).
  //   3. canvas → URL on back-out: `onNavigate` does NOT fire on
  //      breadcrumb clicks (library quirk — see `useNavigation.js`).
  //      We wire `onBreadcrumbClick` to update both `currentRef`
  //      state and the URL so going back to root clears `?canvas=`.
  // -------------------------------------------------------------------
  const searchParams = useSearchParams();
  // Stay on the current route when writing canvas URL params. The
  // canvas only lives at `/org/{login}` today, but reading the
  // pathname keeps the URL writer route-agnostic if we ever mount
  // it elsewhere again.
  const pathname = usePathname();
  /** Imperative handle for `SystemCanvas`; used to drill into a ref from a URL param. */
  const canvasHandleRef = useRef<SystemCanvasHandle | null>(null);
  /** Stores the `addNode` fn from the render-prop so the canvas context menu can invoke it. */
  const addNodeFnRef = useRef<AddNodeButtonRenderProps["addNode"] | null>(null);
  /** Stores all options from the render-prop for context-menu lookup. */
  const menuOptionsRef = useRef<NodeMenuOption[]>([]);
  /**
   * One-shot guard so we only drill into the URL's `?canvas=` once on
   * mount. After that, `onNavigate` / `onBreadcrumbClick` own the URL
   * and the URL would re-feed the same ref back into the handle in a
   * loop. (Future: re-fire when the user pastes a new URL into the
   * same tab — cheaply detected by comparing to `currentRef`.)
   */
  const initialNavAppliedRef = useRef(false);
  /**
   * Truthy from initial render until the deep-link drill-in completes.
   * Captured synchronously from `searchParams` so the spinner overlay
   * shows on the very first paint — the user never sees a flash of the
   * root canvas before the sub-canvas opens.
   *
   * Stored as a ref so the captured value doesn't shift mid-render
   * (and stored separately as state below for the spinner gate, since
   * a ref alone wouldn't trigger re-render on clear).
   */
  const pendingDeepLinkRef = useRef<string | null>(null);
  if (pendingDeepLinkRef.current === null && !initialNavAppliedRef.current) {
    // First render only — capture the URL's `?canvas=` value before any
    // effect runs so the spinner gate below is correct on the initial
    // paint. After this render, `pendingDeepLinkRef` is either the
    // target ref (drill-in pending) or `""` (no deep link, gate stays
    // closed but spinner-state remains false). We use the ref's
    // null/non-null distinction as the "have we captured yet" signal.
    pendingDeepLinkRef.current = searchParams.get("canvas") ?? "";
  }
  const pendingNodeDeepLinkRef = useRef<string | null>(null);
  if (pendingNodeDeepLinkRef.current === null && !initialNavAppliedRef.current) {
    pendingNodeDeepLinkRef.current = searchParams.get("node") ?? "";
  }
  const [deepLinkInFlight, setDeepLinkInFlight] = useState<boolean>(
    () => (searchParams.get("canvas") ?? "") !== "",
  );

  /**
   * Update the `?canvas=<ref>` query param without navigating away
   * from the page. Pass `""` to clear the param (root canvas).
   * Other query params on the page (notably `?c=<connection-slug>`
   * from the Connections sidebar) are preserved.
   */
  const writeCanvasUrlParam = useCallback(
    (ref: string) => {
      // `history.replaceState`, NOT `router.replace`: drilling into a
      // sub-canvas is a pure client-side canvas interaction, and this
      // param is write-only after mount (refresh/share only — see the
      // deep-link block below). A `router.replace` here re-runs the
      // route through middleware + the async `page.tsx` DB query on
      // this `protected` route; any redirect (expired session) or 500
      // there makes the App Router fall back to a FULL hard reload
      // (visible browser-tab spinner). `history.replaceState` updates
      // the URL bar with zero navigation, and still syncs with
      // `useSearchParams` in Next 15.
      const params = new URLSearchParams(window.location.search);
      if (ref === "") {
        params.delete("canvas");
      } else {
        params.set("canvas", ref);
      }
      const qs = params.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );

  /**
   * Library callback: user drilled into a sub-canvas. Scope state
   * (`currentRef`, URL) is now driven by `onBreadcrumbsChange` —
   * which also covers back-navigation and arbitrary-depth breadcrumb
   * clicks — so this handler only owns the side-effect of clearing
   * the selected node. The previously-selected node may not even
   * exist on the new scope; the parent right-panel reverts to its
   * default body.
   */
  /**
   * Single source of truth for selection. The lib's
   * `onSelectionChange` covers every path that mutates selection —
   * node-click, edge-click, canvas-background-click (the new
   * deselect signal), Escape, Delete, navigation, and stale-
   * selection collapse — and emits an atomic update with the final
   * resolved state. We just enrich the edge payload with
   * human-readable endpoint labels (resolved from the canvas's own
   * node list via `getNodeLabel`) and forward to the parent.
   *
   * Replaces the previous patchwork of `onNodeSelect(null)` /
   * `onEdgeSelect(null)` calls scattered across `onNodeClick`,
   * `onEdgeClick`, `onNavigate`, and `onBreadcrumbClick`.
   */
  const handleSelectionChange = useCallback(
    (selection: CanvasSelection) => {
      if (!selection) {
        setSelectedNodeIdForPresence(null);
        onSelectionChange?.(null);
        return;
      }
      if (selection.kind === "node") {
        setSelectedNodeIdForPresence(selection.node.id);
        onSelectionChange?.({
          kind: "node",
          node: selection.node,
          canvasRef: selection.canvasRef,
        });
        return;
      }
      setSelectedNodeIdForPresence(null);
      // Multi-select (lasso / shift-click on multiple nodes) — enrich
      // with internal edges (edges where both endpoints are among the
      // selected nodes) and forward to the parent for summary display.
      if (selection.kind === "multi") {
        const { canvasRef } = selection;
        const sourceCanvas =
          canvasRef === undefined
            ? rootRef.current
            : subCanvasesRef.current[canvasRef];
        const selectedIds = new Set(selection.nodes.map((n) => n.id));
        const allNodes = sourceCanvas?.nodes ?? [];
        const internalEdges: InternalEdge[] = (sourceCanvas?.edges ?? [])
          .filter(
            (e) => selectedIds.has(e.fromNode) && selectedIds.has(e.toNode),
          )
          .map((e) => {
            const fromNode = allNodes.find((n) => n.id === e.fromNode);
            const toNode = allNodes.find((n) => n.id === e.toNode);
            return {
              edge: e,
              fromLabel: fromNode ? getNodeLabel(fromNode) : e.fromNode,
              toLabel: toNode ? getNodeLabel(toNode) : e.toNode,
            };
          });
        onSelectionChange?.({
          kind: "multi",
          nodes: selection.nodes,
          canvasRef: selection.canvasRef,
          internalEdges,
        });
        return;
      }
      // Edge — resolve human labels off the canvas the edge lives on.
      // The refs lag state by one commit, but the edge's endpoints
      // are already in the rendered canvas (it wouldn't have been
      // clickable otherwise) so the lag is harmless here.
      const { edge, canvasRef } = selection;
      const sourceCanvas =
        canvasRef === undefined
          ? rootRef.current
          : subCanvasesRef.current[canvasRef];
      const nodes = sourceCanvas?.nodes ?? [];
      const fromNode = nodes.find((n) => n.id === edge.fromNode);
      const toNode = nodes.find((n) => n.id === edge.toNode);
      const fromLabel = fromNode ? getNodeLabel(fromNode) : edge.fromNode;
      const toLabel = toNode ? getNodeLabel(toNode) : edge.toNode;
      onSelectionChange?.({
        kind: "edge",
        edge,
        canvasRef,
        fromLabel,
        toLabel,
      });
    },
    [onSelectionChange],
  );

  const currentRefRef = useRef(currentRef);
  useEffect(() => {
    currentRefRef.current = currentRef;
  }, [currentRef]);

  const {
    hiddenLive,
    refreshHiddenLive,
    refreshRootHiddenLive,
    handleRestoreLive,
  } = useCanvasHiddenLive({
    githubLogin,
    currentRef,
    currentRefRef,
    setRoot,
    setSubCanvases,
    applyMutation,
    onHiddenChange,
  });

  // Viewport tracking for clipboard paste placement (ref, not state — no re-renders).
  const currentViewportRef = useRef<{ x: number; y: number; zoom: number }>({
    x: 0,
    y: 0,
    zoom: 1,
  });

  // Container ref for reading dimensions during paste position calculation.
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Selected node id for presence broadcasting.
  const [selectedNodeIdForPresence, setSelectedNodeIdForPresence] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Single source of truth for canvas scope: the library's breadcrumb
  // trail.
  //
  // The lib emits this on every navigation event — drill-in,
  // breadcrumb click, programmatic `zoomIntoNode`, `navigateBack` —
  // for any depth (root → initiative → milestone today, deeper if we
  // nest further). We mirror three things off it:
  //
  //   1. `currentRef`: the deepest entry's ref, or `""` for root.
  //      Drives the HiddenLivePill, scope-aware `+` menu, etc.
  //   2. The `?canvas=` URL param: mirrors `currentRef` so deep links
  //      survive refresh and tab-shares.
  //   3. The breadcrumb string forwarded to the chat overlay so the
  //      AI agent can name the user's scope ("Acme › Auth Refactor ›
  //      M1") rather than echoing an opaque ref id.
  //
  // The library always emits at least the root entry on initial
  // mount, so subscribers don't need to wait for navigation.
  // -------------------------------------------------------------------
  const handleBreadcrumbsChange = useCallback(
    (entries: BreadcrumbEntry[]) => {
      // Last entry's ref is the deepest scope. The root entry has no
      // `ref` field, so an empty trail (or root-only trail) collapses
      // to `""` — which is our convention for "on root."
      const deepest = entries[entries.length - 1]?.ref ?? "";
      // Only touch state / URL when the scope actually changed. The
      // lib emits this on every render of its navigation hook; the
      // breadcrumb-string forward below is cheap enough to run every
      // time, but skipping the URL/state writes here matters for the
      // initial deep-link path: the lib fires the root-only trail
      // before its async drill-in completes, and writing `""` would
      // briefly clobber the user's `?canvas=` param.
      setCurrentRef((prev) => (prev === deepest ? prev : deepest));
      if (currentRefRef.current !== deepest) {
        writeCanvasUrlParam(deepest);
      }
      onCanvasBreadcrumbChange?.(entries.map((e) => e.label).join(" › "));
    },
    [writeCanvasUrlParam, onCanvasBreadcrumbChange],
  );

  // Scrolls to and zooms into a specific node by ID. Used for `?node=`
  // deep-link resolution. Silently swallows rejection (stale link —
  // node no longer exists on the current canvas).
  const scrollToNode = useCallback(
    (nodeId: string) => {
      if (!nodeId || !canvasHandleRef.current) return;
      const canvasData = currentRef
        ? subCanvasesRef.current[currentRef]
        : root;
      const node = canvasData?.nodes?.find((n) => n.id === nodeId);
      const containerW = canvasContainerRef.current?.clientWidth ?? 0;
      const targetZoom = computeNodeFocusZoom(node?.width ?? 260, containerW);
      void canvasHandleRef.current
        .zoomIntoNode(nodeId, { targetZoom, durationMs: 600 })
        .catch(() => {
          // stale link — node no longer exists; already on right canvas, silent no-op
        });
    },
    [currentRef, root],
  );

  // ── Canvas deeplink chip navigation ────────────────────────────────
  // Consumes `pendingDeeplink` from the chat store. When the user clicks
  // a `CanvasDeeplinkChip` in chat, the store slot is set; this effect
  // fires, navigates to the correct sub-canvas (if needed), then pans
  // and zooms to the target node. `clearDeeplink()` is always called in
  // `finally` so the slot is never stuck.
  const pendingDeeplink = useCanvasChatStore((s) => s.pendingDeeplink);
  const clearDeeplink = useCanvasChatStore((s) => s.clearDeeplink);

  useEffect(() => {
    if (!pendingDeeplink || !canvasHandleRef.current) return;
    const handle = canvasHandleRef.current;
    const { nodeId, canvasRef } = pendingDeeplink;

    const doNavigate =
      canvasRef && canvasRef !== currentRef
        ? handle
            .zoomIntoNode(canvasRef, { durationMs: 300 })
            .then(() => scrollToNode(nodeId))
        : Promise.resolve().then(() => scrollToNode(nodeId));

    void doNavigate.finally(() => clearDeeplink());
  }, [pendingDeeplink, currentRef, scrollToNode, clearDeeplink]);

  // Initial drill-in from `?canvas=<ref>`. Runs once after the root
  // canvas has loaded — `zoomIntoNode` requires the projected node
  // (e.g. `initiative:<id>`) to actually exist on the rendered canvas.
  // The guarded `initialNavAppliedRef` keeps this from firing twice on
  // strict-mode / fast-refresh re-renders.
  //
  // The spinner overlay (see JSX) covers the canvas from initial
  // paint until this promise resolves, so the user never sees a
  // flash of the root canvas before the sub-canvas mounts.
  useEffect(() => {
    if (!root || initialNavAppliedRef.current) return;
    const targetRef = pendingDeepLinkRef.current ?? "";
    if (targetRef === "" || targetRef === currentRef) {
      // No deep link, or already there — nothing to do. Clear the
      // spinner gate (which only fires for true deep links anyway).
      initialNavAppliedRef.current = true;
      setDeepLinkInFlight(false);
      if (pendingNodeDeepLinkRef.current) {
        scrollToNode(pendingNodeDeepLinkRef.current);
      }
      return;
    }
    // Today the projector emits a node whose `id` matches the ref it
    // drills into (e.g. the `initiative:<id>` node on root carries
    // `ref: "initiative:<id>"`). So zooming into the id navigates
    // into the matching sub-canvas in one shot.
    //
    // If the ref doesn't resolve to an on-canvas node (e.g. a stale
    // share link to a deleted initiative), the handle's promise just
    // resolves without navigating; the user lands on root, which is
    // the right fallback.
    const handle = canvasHandleRef.current;
    if (!handle) return;
    initialNavAppliedRef.current = true;
    // `durationMs: 0` skips the camera dive-in animation. For a deep
    // link the user just wants to land on the sub-canvas — a 900ms
    // cinematic zoom every time they refresh would feel sluggish.
    // (Drilling in via a click still gets the default animation; that
    // path uses the library's internal navigation flow, not this
    // imperative call.)
    //
    // The promise resolves once the sub-canvas has mounted AND its
    // auto-fit has run (see the library's two-RAF wait inside
    // `zoomIntoNode`). At that point the spinner is safe to drop —
    // the user is already looking at the right canvas.
    void handle
      .zoomIntoNode(targetRef, { durationMs: 0 })
      .then(() => {
        if (pendingNodeDeepLinkRef.current) {
          scrollToNode(pendingNodeDeepLinkRef.current);
        }
      })
      .catch((err) => {
        console.error(
          "[OrgCanvasBackground] zoomIntoNode failed for URL ref",
          targetRef,
          err,
        );
      })
      .finally(() => {
        setDeepLinkInFlight(false);
      });
    // Intentionally not depending on `searchParams` / `currentRef` —
    // we only want this to fire once on initial mount. Subsequent
    // navigation flows write to the URL, not the other way around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, scrollToNode]);

  // (No runtime-reactive `?canvas=` follower. We previously had one
  // here so the AttentionList card could push `?canvas=&select=` onto
  // the URL and have the canvas drill in to match. That sync path was
  // fragile — `router.replace` lags `useSearchParams` by a render, so
  // breadcrumb-back was racing with our own URL writes and bouncing
  // the user back into the sub-canvas they just exited. AttentionList
  // now opens the workspace-scoped page in a new tab instead, which
  // sidesteps the sync problem entirely. The mount-only deep-link
  // effect above is the only `?canvas=` consumer; the URL is
  // write-only after that, and `handleBreadcrumbsChange` is the
  // single source of truth for `currentRef`.)

  // Listen for agent-driven canvas updates. When the AI agent (or any
  // other tab / user) rewrites the canvas through `update_canvas` /
  // `patch_canvas`, the server emits `CANVAS_UPDATED` on the org channel
  // so every open viewer refetches and re-renders.
  //
  // Important: we skip the refetch if we have unsaved local edits
  // pending — the user's in-flight changes would be silently clobbered
  // by a read of stale remote state. The autosave flush will propagate
  // our edits shortly, and if a collision happens, last-write-wins.
  //
  // Subscription lifecycle is owned by `usePusherChannel` (refcounted)
  // so this component coexists safely with other consumers of the same
  // org channel — notably `ConnectionsListBody`, which used to call
  // `pusher.unsubscribe` directly and orphan our handler on every
  // parent re-render.
  const channelName = getOrgChannelName(githubLogin);
  const channel = usePusherChannel(channelName);
  useEffect(() => {
    if (!channel) return;

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
        refreshRootHiddenLive();
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
      // If the update is for the canvas the user is currently looking
      // at, refresh its hidden list too — agents can hide live nodes
      // on sub-canvases just like on root.
      if (ref === currentRefRef.current) {
        refreshHiddenLive();
      }
    };

    channel.bind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
    return () => {
      channel.unbind("pusher:subscription_succeeded", handleSubSucceeded);
      channel.unbind("pusher:subscription_error", handleSubError);
      channel.unbind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
    };
  }, [channel, channelName, githubLogin]);

  const {
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
  } = useCanvasNodeOps({
    githubLogin,
    currentRefRef,
    rootRef,
    subCanvasesRef,
    applyMutation,
    setRoot,
    setSubCanvases,
    refreshHiddenLive,
    refreshRootHiddenLive,
  });

  // Real-time canvas presence — cursors, selection halos, conflict flash
  const { collaborators } = useCanvasCollaboration({
    githubLogin,
    canvasRef: currentRef,
    userId: session?.user?.id ?? "",
    userName: session?.user?.name ?? "",
    userImage: session?.user?.image ?? null,
    getViewport: () => canvasHandleRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 },
    getSvgElement: () => canvasHandleRef.current?.getSvgElement?.() ?? null,
    containerRef: canvasContainerRef,
    selectedNodeId: selectedNodeIdForPresence,
    enabled: !!(session?.user?.id),
  });


  const {
    handleEdgeAdd,
    handleEdgeUpdate,
    handleEdgeDelete,
    canDropNodeOn,
    handleNodeDrop,
  } = useCanvasEdgeOps({
    githubLogin,
    applyMutation,
    edgePatchHandleRef,
    canvasHandleRef,
    subCanvasesRef,
  });
  /**
   * Visually highlight edges that have a linked Connection doc. The
   * lib renders edges using `theme.edge.stroke` by default; setting
   * `edge.color` overrides that with a per-edge value. We map linked
   * edges to a brighter slate so they stand out at a glance — small
   * affordance, big discoverability win (the user can see at a
   * glance which edges have docs behind them).
   *
   * Decoration is render-only: it lands on the data passed to
   * `<SystemCanvas>` but NOT on the persisted blob. `applyMutation`
   * reads from `rootRef.current` / `subCanvasesRef.current` (the
   * undecorated state mirrors), so writes never leak the visual
   * `color` back into the canvas. Memoized on the source canvas so
   * the lib's edge-render pass stays pure.
   */
  const decorateEdgesWithLinkVisual = useCallback(
    (data: CanvasData): CanvasData => {
      const edges = data.edges ?? [];
      let changed = false;
      const next = edges.map((e) => {
        const cd = (e as { customData?: { connectionId?: unknown } })
          .customData;
        const linked =
          typeof cd?.connectionId === "string" && cd.connectionId.length > 0;
        // Don't override an explicit user-set color — if the edge
        // already has one, the user (or agent) made a deliberate
        // visual choice we shouldn't clobber.
        if (linked && !e.color) {
          changed = true;
          return { ...e, color: LINKED_EDGE_COLOR };
        }
        return e;
      });
      return changed ? { ...data, edges: next } : data;
    },
    [],
  );

  const canvasForRender = useMemo<CanvasData>(
    () => decorateEdgesWithLinkVisual(root ?? { nodes: [], edges: [] }),
    [root, decorateEdgesWithLinkVisual],
  );

  // Sub-canvases also need decoration so links are highlighted on
  // every scope (root, workspace sub-canvas, initiative sub-canvas).
  // Memoized as a fresh object only when an underlying ref changes.
  const subCanvasesForRender = useMemo<Record<string, CanvasData>>(() => {
    const out: Record<string, CanvasData> = {};
    for (const [ref, data] of Object.entries(subCanvases)) {
      out[ref] = decorateEdgesWithLinkVisual(data);
    }
    return out;
  }, [subCanvases, decorateEdgesWithLinkVisual]);

  // Set of connection ids referenced by at least one edge across all
  // canvases we've loaded this session. Walked off the same `root` +
  // `subCanvases` state the renderer already uses, so it stays in
  // sync automatically (link/unlink → state update → fresh set).
  // The sidebar uses this to mark connections that are wired up.
  const linkedConnectionIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    const collect = (data: CanvasData | null | undefined) => {
      for (const e of data?.edges ?? []) {
        const cd = (e as { customData?: { connectionId?: unknown } })
          .customData;
        if (typeof cd?.connectionId === "string" && cd.connectionId.length > 0) {
          ids.add(cd.connectionId);
        }
      }
    };
    collect(root);
    for (const data of Object.values(subCanvases)) collect(data);
    return ids;
  }, [root, subCanvases]);

  useEffect(() => {
    onLinkedConnectionIdsChange?.(linkedConnectionIds);
  }, [linkedConnectionIds, onLinkedConnectionIdsChange]);

  // Clear the viewport slot in the canvas chat store on unmount so stale
  // coordinates from a previous canvas session never leak into the next.
  useEffect(() => {
    return () => {
      useCanvasChatStore.getState().setCanvasViewport(null);
    };
  }, []);

  // Anchor the canvas container to the viewport but leave `rightInset`
  // pixels of empty space on the right so the library-owned FAB + future
  // toolbar affordances sit to the LEFT of the sidebar. The background
  // color still paints the full inset area (via a separate div) so the
  // sidebar doesn't reveal the page background underneath.
  const canvasContainerStyle: React.CSSProperties = {
    right: rightInset,
  };

  /**
   * Right-click menu on canvas nodes. Currently surfaces one item:
   * **"Promote to Feature…"** on note nodes. Selecting it opens the
   * `CreateFeatureCanvasDialog` with the note's `text` pre-filled
   * (truncated for the title, full text as the description) and the
   * source note id stashed on `pendingAdd` so we delete the note
   * after the feature is created — the user "consumed" the note
   * when they promoted it. Allowed on every scope; the dialog handles
   * per-scope field locking.
   *
   * `useMemo` keeps the config object reference stable across renders;
   * `<SystemCanvas>` reads it on every render to filter items per node,
   * but a fresh config every render would force the library's internal
   * effects to re-bind unnecessarily.
   */
  /**
   * Unpin a feature card from a workspace sub-canvas. Right-click
   * affordance on `feature:` nodes when the user is on a `ws:<id>`
   * scope. The mutation only touches the canvas overlay
   * (`Canvas.data.assignedFeatures`) — the Feature row itself is
   * unchanged. Optimistic local refetch is sufficient; the API
   * route's Pusher fan-out covers other tabs.
   *
   * No confirm dialog by design: pinning is a layout decision
   * symmetric to dragging a card off-screen, and reversing it via
   * the Assign-existing tab is one click away. Matches the
   * "layout-only, not destructive" framing of the feature.
   */
  const handleUnpinFeatureFromWorkspace = useCallback(
    async (featureLiveId: string, workspaceRef: string) => {
      const featureId = featureLiveId.startsWith("feature:")
        ? featureLiveId.slice("feature:".length)
        : featureLiveId;
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/canvas/assigned-features`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ref: workspaceRef,
              featureId,
              action: "unassign",
            }),
          },
        );
        if (!res.ok) {
          console.error(
            "[OrgCanvasBackground] unassign feature failed",
            res.status,
          );
          return;
        }
        const data = await fetchSub(githubLogin, workspaceRef);
        setSubCanvases((prev) => ({ ...prev, [workspaceRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] unassign feature error",
          err,
        );
      }
    },
    [githubLogin],
  );

  const nodeContextMenu = useMemo<NodeContextMenuConfig>(
    () => ({
      // Item set is composed conditionally per scope. The library
      // does NOT support `match.scope` today, so we filter the items
      // array up-front based on `currentRef` and let `match.categories`
      // do the rest. Memo dep includes `currentRef` so the menu
      // rebuilds on navigation. Showing a labelled menu item that
      // does nothing on click is a discoverability bug — filter it
      // out instead of relying on an onSelect guard.
      items: [
        {
          id: "promote-to-feature",
          label: "Promote to Feature…",
          // Only notes are promotable. Other categories (decisions,
          // projected live nodes, base text/file/link/group) get no
          // menu — the library treats "zero matched items" as "don't
          // open", so right-clicking them is a silent no-op.
          match: { categories: ["note"] },
        },
        // "Remove from canvas" only makes sense on a `ws:<id>` scope
        // (where pinning is honored). Drop the item entirely on root /
        // initiative / opaque scopes so right-clicking a feature card
        // on those canvases shows no menu (which the library handles
        // by not opening it, same as a non-matching category).
        ...(currentRef.startsWith("ws:")
          ? ([
              {
                id: "unpin-feature-from-workspace" as const,
                label: "Remove from canvas",
                match: { categories: ["feature"] as const },
              },
            ] as NodeContextMenuConfig["items"])
          : []),
        // View Details — live nodes (feature, initiative, workspace, research)
        {
          id: "view-details",
          label: "View Details",
          match: {
            when: (node: CanvasNode) => isLiveId(node.id),
          },
        },
        // Navigate Into — drillable containers only
        {
          id: "navigate-into",
          label: "Navigate Into",
          match: {
            when: (node: CanvasNode) =>
              node.id.startsWith("ws:") || node.id.startsWith("initiative:"),
          },
        },
        // Copy Link — available on every node
        {
          id: "copy-link",
          label: "Copy Link",
          match: { when: () => true },
        },
        // Delete — all nodes; live nodes are hidden, authored are removed
        {
          id: "delete",
          label: "Delete",
          destructive: true,
          match: { when: () => true },
        },
      ],
      onSelect: (itemId, node, ctx) => {
        if (itemId === "copy-link") {
          const url = new URL(window.location.href);
          const canvasRef = ctx.canvasRef ?? "";
          if (canvasRef) {
            url.searchParams.set("canvas", canvasRef);
          } else {
            url.searchParams.delete("canvas");
          }
          url.searchParams.set("node", node.id);
          void navigator.clipboard.writeText(url.toString()).then(() => {
            toast.success("Link copied to clipboard!");
          });
          return;
        }
        if (itemId === "delete") {
          handleNodeDelete(node.id, ctx.canvasRef ?? undefined);
          return;
        }
        if (itemId === "view-details") {
          handleSelectionChange({
            kind: "node",
            node,
            canvasRef: ctx.canvasRef ?? undefined,
          });
          return;
        }
        if (itemId === "navigate-into") {
          void canvasHandleRef.current?.zoomIntoNode(node.id);
          return;
        }
        if (itemId === "promote-to-feature") {
          const text = (node.text ?? "").trim();
          // Title pre-fill: first non-empty line, capped to fit the
          // dialog's input. Full text always seeds the description so
          // the user doesn't lose context when the title gets truncated.
          const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
          const titleSeed = firstLine.slice(0, 80);
          const briefSeed = text;
          // The library types `ctx.canvasRef` as `string | null` (null
          // for the root canvas); the rest of OrgCanvasBackground uses
          // `string | undefined`. Coerce so `startFeatureCreate`'s
          // signature matches the `+` menu path.
          startFeatureCreate(
            node,
            ctx.canvasRef ?? undefined,
            { title: titleSeed, brief: briefSeed },
            node.id,
          );
          return;
        }
        if (itemId === "unpin-feature-from-workspace") {
          const canvasRef = ctx.canvasRef ?? "";
          // Defensive — the menu items array drops this entry on
          // non-`ws:` scopes, so the only way we'd get here on a
          // non-ws ref is a stale library callback firing during
          // navigation. Bail silently rather than write to the
          // wrong canvas.
          if (!canvasRef.startsWith("ws:")) return;
          void handleUnpinFeatureFromWorkspace(node.id, canvasRef);
          return;
        }
      },
    }),
    [
      currentRef,
      startFeatureCreate,
      handleUnpinFeatureFromWorkspace,
      handleNodeDelete,
      handleSelectionChange,
      canvasHandleRef,
    ],
  );

  /**
   * Empty-canvas right-click menu — scope-filtered creation options
   * mirroring the [+] button. Items are split into DB-backed (dialog)
   * and authored (immediate) groups with a visual separator between them.
   */
  const canvasContextMenu = useMemo<CanvasContextMenuConfig>(() => {
    const DB_BACKED = new Set(["initiative", "feature", "milestone"]);

    const allowedCategories = CATEGORY_REGISTRY.filter(
      (c) =>
        (c as { userCreatable?: boolean }).userCreatable !== false &&
        categoryAllowedOnScope(c.id, currentRef),
    );

    const dbItems: CanvasContextMenuItem[] = allowedCategories
      .filter((c) => DB_BACKED.has(c.id))
      .map((c) => ({
        id: c.id,
        label: `New ${c.id.charAt(0).toUpperCase() + c.id.slice(1)}`,
      }));

    const authoredItems: CanvasContextMenuItem[] = [
      ...allowedCategories
        .filter((c) => !DB_BACKED.has(c.id))
        .map((c) => ({
          id: c.id,
          label: `New ${c.id.charAt(0).toUpperCase() + c.id.slice(1)}`,
        })),
      { id: "type:text", label: "Text" },
      { id: "type:file", label: "File" },
      { id: "type:link", label: "Link" },
      { id: "type:group", label: "Group" },
    ];

    const items: CanvasContextMenuItem[] = [
      ...dbItems,
      ...(dbItems.length > 0 && authoredItems.length > 0
        ? [{ id: "__sep__", label: "---" }]
        : []),
      ...authoredItems,
    ];

    return {
      items,
      onSelect: (itemId, ctx) => {
        const opt = menuOptionsRef.current.find((o) =>
          o.kind === "category"
            ? o.value === itemId
            : `type:${o.value}` === itemId,
        );
        if (!opt || !addNodeFnRef.current) return;
        addNodeFnRef.current(opt, { x: ctx.position.x, y: ctx.position.y });
      },
    };
  }, [currentRef]);

  /**
   * Replace the library's default FAB container so we can hoist the
   * button above the chat-input bar. The library would otherwise place it
   * at `bottom:16` of the canvas, which sits underneath the chat input's
   * `pointer-events-auto` wrapper and can't receive clicks.
   *
   * Menu filtering is **scope-aware**: each option is run through
   * `categoryAllowedOnScope` against `currentRef`, so the user only
   * sees categories that make sense at the canvas they're currently
   * looking at:
   *   - Root → initiative, note, decision, text/file/link/group
   *   - Workspace sub-canvas → note, decision, text/file/link/group
   *   - Initiative timeline → milestone, note, decision, text/...
   *
   * `kind: "type"` options (the library's built-in JSON-canvas types)
   * are always shown — they're free authoring primitives and have no
   * scope semantics.
   *
   * `currentRef` is captured lexically; React re-renders the component
   * whenever the user navigates (we set it in onNavigate), and the
   * library calls this render-prop on every render, so the menu
   * tracks scope changes automatically.
   */
  /**
   * Persist the canvas snapshot after an undo/redo step. The library has
   * already applied the history state before this fires, so we simply read
   * whatever is in memory for the affected ref and schedule a debounced save.
   *
   * The `scheduleSave` call goes through the same debounce path as every
   * other mutation, so rapid Cmd+Z presses collapse into a single network
   * request. No delta is applied — it is a pure snapshot save, which avoids
   * the double-save risk of re-running any of the delta handlers.
   */
  const handleUndo = useCallback(
    (canvasRef: string | undefined) => {
      scheduleSave(canvasRef);
    },
    [scheduleSave],
  );

  const handleRedo = useCallback(
    (canvasRef: string | undefined) => {
      scheduleSave(canvasRef);
    },
    [scheduleSave],
  );

  const renderAddNodeButton = (props: AddNodeButtonRenderProps) => {
    addNodeFnRef.current = props.addNode;
    menuOptionsRef.current = props.options;
    const filtered = {
      ...props,
      options: props.options.filter((o) => {
        if (o.kind !== "category") return true;
        return categoryAllowedOnScope(o.value, currentRef);
      }),
    };
    return <AddNodeButton {...filtered} />;
  };

  if (loadError) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#15171c]">
        <p className="text-sm text-muted-foreground">Failed to load canvas</p>
        <Button variant="outline" size="sm" onClick={retryLoad}>
          Retry
        </Button>
      </div>
    );
  }

  if (!root) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#15171c]">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="absolute inset-0 bg-[#15171c]" aria-hidden />
      <div ref={canvasContainerRef} className="absolute inset-y-0 left-0" style={canvasContainerStyle}>
        <SystemCanvas
          ref={canvasHandleRef}
          canvas={canvasForRender}
          panMode="trackpad"
          multiSelectKey="space"
          canvases={subCanvasesForRender}
          theme={connectionsTheme}
          editable
          zoomNavigation
          onResolveCanvas={onResolveCanvas}
          onBreadcrumbsChange={handleBreadcrumbsChange}
          onSelectionChange={handleSelectionChange}
          onNodeAdd={handleNodeAdd}
          onNodeUpdate={handleNodeUpdate}
          onNodesUpdate={handleNodesUpdate}
          onNodeDelete={handleNodeDelete}
          onNodesDelete={handleNodesDelete}
          onEdgeAdd={handleEdgeAdd}
          onEdgeUpdate={handleEdgeUpdate}
          onEdgeDelete={handleEdgeDelete}
          canDropNodeOn={canDropNodeOn}
          onNodeDrop={handleNodeDrop}
          onUndo={handleUndo}
          onRedo={handleRedo}
          historyDepth={100}
          nodeContextMenu={nodeContextMenu}
          canvasContextMenu={canvasContextMenu}
          renderAddNodeButton={renderAddNodeButton}
          rootLabel={orgName || githubLogin}
          onViewportChange={(vp) => {
            currentViewportRef.current = vp;
            const rect = canvasContainerRef.current?.getBoundingClientRect();
            useCanvasChatStore.getState().setCanvasViewport({
              x: vp.x,
              y: vp.y,
              zoom: vp.zoom,
              containerW: rect?.width ?? 0,
              containerH: rect?.height ?? 0,
            });
          }}
          collaborators={collaborators}
        />
        {/*
         * Restore pill — top-right of the canvas area. Shown on any
         * canvas with at least one hidden live node: workspaces on
         * root, repos on a workspace sub-canvas, milestones on an
         * initiative sub-canvas. The pill auto-hides when entries are
         * empty, so the 99% steady-state is zero chrome regardless of
         * scope. Hidden lists are per-canvas (`Canvas.data.hidden` is
         * a per-ref overlay), so `hiddenLive` is refetched on every
         * `currentRef` change. Sits inside the canvas container so it
         * tracks `rightInset` alongside the canvas itself.
         */}
        <HiddenLivePill
          // Pre-fetch (`hiddenLive === null`) the pill is given an
          // empty list — it auto-hides when there's nothing to show,
          // so this just keeps it dormant until the fetch lands.
          entries={hiddenLive ?? []}
          onRestore={handleRestoreLive}
        />


        {/*
         * Deep-link load overlay. When the page loads with a `?canvas=`
         * query param, we mount the root canvas first (the library
         * needs it to find the target node before `zoomIntoNode` can
         * navigate). That brief moment of "root visible" before the
         * sub-canvas opens reads as a flash. This overlay covers the
         * canvas with the same background + a spinner so the user
         * sees only "loading → already on the right canvas." Cleared
         * when `zoomIntoNode`'s promise resolves (sub-canvas mounted
         * and auto-fit complete).
         *
         * Only shown when `deepLinkInFlight` started true (URL had
         * `?canvas=`). Subsequent in-app drill-ins don't go through
         * this overlay; they animate naturally.
         */}
        {deepLinkInFlight && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-[#15171c]"
            aria-busy="true"
            aria-label="Loading canvas"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}
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
        onSave={handleSaveMilestone}
      />
      <CreateFeatureCanvasDialog
        open={pendingAdd?.kind === "feature"}
        onClose={() => setPendingAdd(null)}
        githubLogin={githubLogin}
        scope={
          pendingAdd?.kind === "feature" ? pendingAdd.canvasRef ?? "" : ""
        }
        prefill={pendingAdd?.kind === "feature" ? pendingAdd.prefill : undefined}
        // The Promote-to-Feature path sets `sourceNoteId` on `pendingAdd`
        // to the originating note's id. Threaded through so the dialog
        // can pre-select fields based on edges incident to that note
        // (e.g. note → initiative on root pre-selects the initiative).
        sourceNodeId={
          pendingAdd?.kind === "feature" ? pendingAdd.sourceNoteId : undefined
        }
        onSave={handleSaveFeature}
        onAssign={handleAssignFeature}
      />
      <CreateServiceCanvasDialog
        open={pendingAdd?.kind === "service"}
        onClose={() => setPendingAdd(null)}
        onSave={handleSaveService}
      />
    </>
  );
}
