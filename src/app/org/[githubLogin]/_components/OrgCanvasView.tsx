"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { CanvasEdge, CanvasNode, EdgeUpdate } from "system-canvas";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  OrgCanvasBackground,
  type SelectionWithLabels,
  type InternalEdge,
} from "../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../connections/HiddenLivePill";
import type { ConnectionData } from "../connections/types";
import { OrgRightPanel } from "./OrgRightPanel";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "../_state/canvasChatStore";
import { useCanvasChatAutoSave } from "../_state/useCanvasChatAutoSave";
import { useSubAgentStatusRefresh } from "../_state/useSubAgentStatusRefresh";
import type { ActivityItem } from "@/app/api/profile/activity/route";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

/**
 * Sidebar layout sizes (percent of container width).
 *
 * Connection viewing happens *inside* the sidebar — when the user
 * opens a connection we imperatively grow the panel to
 * `EXPANDED_SIZE` so the viewer has room (diagram + scalar iframe
 * each want a few hundred pixels of breathing room), then restore to
 * the prior width when the user goes back. The user's own resize is
 * preserved through `autoSaveId` so manual sizing wins on next mount.
 */
const SIDEBAR_DEFAULT_SIZE = 24;
const SIDEBAR_MIN_SIZE = 16;
const SIDEBAR_MAX_SIZE = 80;
const SIDEBAR_EXPANDED_SIZE = 60;

/** Strip the `ws:` prefix from a live workspace id. */
function stripWsPrefix(liveId: string): string {
  return liveId.startsWith("ws:") ? liveId.slice(3) : liveId;
}

interface OrgCanvasViewProps {
  githubLogin: string;
  orgId: string;
  orgName: string | null;
}

/**
 * The org canvas view — the default `/org/[githubLogin]` route.
 *
 * Two layers:
 *   1. Full-bleed system-canvas (`OrgCanvasBackground`) on the left.
 *   2. Fixed-width tabbed right panel (`OrgRightPanel`) on the right
 *      with three tabs — **Chat** (`SidebarChat`, default landing
 *      tab), **Details**, **Connections**.
 *
 * This component owns the canvas chat *lifecycle*: starting the
 * active conversation in the store, keeping its `context` up to
 * date as the user navigates the canvas, preloading from
 * `?chat=<shareId>`, and mounting the auto-save subscription. The
 * conversation's *contents* (messages, loading, tool calls) live in
 * the store; `<SidebarChat />` reads them directly without prop
 * drilling.
 */
export function OrgCanvasView({ githubLogin, orgId, orgName }: OrgCanvasViewProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { slug: workspaceSlug } = useWorkspace();

  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  /**
   * Width the sidebar had before we auto-expanded for a connection
   * viewer. Restored on `handleBack`. `null` when not in an
   * auto-expanded state. Stored as a percent of container width
   * (matches the `react-resizable-panels` API surface).
   */
  const preExpandSizeRef = useRef<number | null>(null);
  /**
   * Sidebar width in pixels. Drives the canvas's `rightInset` so the
   * canvas + library FAB sit to the LEFT of the sidebar instead of
   * being clipped by it.
   *
   * Initialized to a placeholder (384px ≈ 24% of a typical viewport)
   * because we can't measure the panel before it mounts. The
   * `useLayoutEffect` below replaces this with the panel's *actual*
   * pixel width before the first paint — without it, the user sees
   * a 1-frame gap on initial render whenever the saved panel size
   * (via `autoSaveId`) doesn't match the placeholder, because
   * `react-resizable-panels`' `onResize` only fires when the size
   * changes from `defaultSize`. Equal-to-default means no callback,
   * which means the placeholder sticks until the user manually drags.
   */
  const [panelWidth, setPanelWidth] = useState(384);

  // Sync `panelWidth` to the panel's actual rendered width on mount,
  // before the browser paints. Two paths land it at the right value:
  //
  //   1. Read the panel's percent via the imperative handle and the
  //      container's measured pixel width — covers the case where
  //      `autoSaveId` restored a size equal to `defaultSize` (no
  //      `onResize` callback fires there, so this is the only signal
  //      we get on first mount).
  //   2. A `ResizeObserver` on the container catches subsequent
  //      viewport resizes (window resize, devtools open, etc.) so
  //      `rightInset` stays correct without depending on the panel
  //      itself changing size. 
  //
  // `useLayoutEffect` (vs `useEffect`) so the canvas's `rightInset`
  // is correct on the very first commit, eliminating the visible
  // gap-then-snap on initial render.
  useLayoutEffect(() => {
    const syncFromPanel = () => {
      const panel = sidebarPanelRef.current;
      const container = containerRef.current;
      if (!panel || !container) return;
      const percent = panel.getSize();
      const containerWidth = container.offsetWidth;
      if (containerWidth === 0) return;
      setPanelWidth(Math.round((percent / 100) * containerWidth));
    };
    syncFromPanel();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncFromPanel);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const [workspaces, setWorkspaces] = useState<{ id: string; slug: string; isDefault?: boolean }[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenInitialized, setHiddenInitialized] = useState(false);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [activeConnection, setActiveConnection] = useState<ConnectionData | null>(null);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<CanvasNode[]>([]);
  const [selectedNodesInternalEdges, setSelectedNodesInternalEdges] = useState<InternalEdge[]>([]);
  /**
   * Set of connection ids referenced by at least one edge across the
   * canvases the user has visited this session. Surfaced from
   * `OrgCanvasBackground` (which owns the canvas blobs) so the
   * sidebar can render a small "linked" dot on those rows.
   */
  const [linkedConnectionIds, setLinkedConnectionIds] = useState<Set<string>>(
    () => new Set(),
  );
  /**
   * The edge the user has currently selected on the canvas, paired
   * with the canvas ref it lives on AND the resolved human labels
   * for its endpoints. Mutually exclusive with `selectedNode` from
   * the user's POV — clicking a node clears the edge, clicking an
   * edge clears the node. The two pieces of state are tracked
   * independently so the right-panel can render either detail body
   * without coupling.
   *
   * `canvasRef` is `undefined` for root, matching `applyMutation`'s
   * convention. We capture it at click-time so the link/unlink write
   * lands on the correct canvas blob even if the user navigates.
   *
   * `fromLabel` / `toLabel` are resolved by `OrgCanvasBackground`
   * from the canvas's own node list (where the live-node `text` is
   * the entity's real name — e.g. workspace.name). Captured here
   * rather than re-resolved on the consumer side because the canvas
   * data lives in `OrgCanvasBackground`; surfacing them on the
   * selection payload avoids prop-drilling the node map.
   */
  const [selectedEdge, setSelectedEdge] = useState<{
    edge: CanvasEdge;
    canvasRef: string | undefined;
    fromLabel: string;
    toLabel: string;
  } | null>(null);
  /**
   * Imperative handle exposed by `OrgCanvasBackground` for patching
   * an edge's data. Used by the link / unlink flows to write
   * `customData.connectionId` without prop-drilling a callback
   * through every list row. Set inside `OrgCanvasBackground` via
   * an effect; null when the canvas is unmounted.
   */
  const edgePatchHandleRef = useRef<
    | ((
        edgeId: string,
        patch: EdgeUpdate,
        canvasRef: string | undefined,
      ) => void)
    | null
  >(null);
  /**
   * Human-readable breadcrumb for the canvas the user is currently
   * looking at. Threaded into the chat so the agent can refer to the
   * scope by name in replies.
   */
  const [currentCanvasBreadcrumb, setCurrentCanvasBreadcrumb] = useState("");

  // Optional `?chat=<conversationId>` preload. The URL tracks the live
  // conversation row (set on row creation, and what "copy share link"
  // hands out). Landing on one preloads that conversation and adopts it
  // as our server row, so we RESUME our own chat after a reload — or
  // JOIN someone else's shared room — rather than starting a fresh one.
  const sharedChatId = searchParams.get("chat");
  const [chatInitialMessages, setChatInitialMessages] =
    useState<CanvasChatMessage[] | null>(null);
  const [chatInitialSenderProfiles, setChatInitialSenderProfiles] =
    useState<Record<string, { username: string; avatarUrl?: string }>>({});
  const [chatLoadComplete, setChatLoadComplete] = useState(false);

  // Synthetic "My Activity" intro — fetched from /api/profile/activity.
  // Resolved before `startConversation` fires so the seed lands cleanly
  // into the new conversation. Intentionally skipped when:
  //   - `?chat=<id>` is present (resuming/joining an existing room — we'd
  //     be polluting an established transcript with the intro).
  //   - The user dismissed the intro during this session (×).
  // See `_components/MyActivityPanel.tsx` for the rendered card.
  const [activityData, setActivityData] = useState<ActivityItem[] | null>(null);
  const [activityLoadComplete, setActivityLoadComplete] = useState(false);

  const setUrlSlug = useCallback(
    (slug: string | null) => {
      // `history.replaceState` (NOT `router.replace`) so updating this
      // deep-link param never triggers a Next navigation / RSC fetch on
      // this `protected` route. A router navigation re-runs middleware +
      // the async `page.tsx` DB query, and any redirect/500 there
      // degrades to a full hard reload. See CANVAS.md "Deep links".
      const params = new URLSearchParams(window.location.search);
      if (slug) params.set("c", slug);
      else params.delete("c");
      const qs = params.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );

  /**
   * `?r=<research-slug>` writer — symmetric to `?c=` but for the
   * Research viewer. Setting the slug opens the research doc in the
   * Details tab (via a synthesized `selectedNode`); clearing it drops
   * the deep link without touching the rest of the URL.
   *
   * Why a separate param from `?c=`: connections and research are
   * different surfaces (right-panel Connections tab vs Details tab,
   * different DB tables, different agent tool families), and having
   * two distinct params lets a single URL deep-link into both
   * simultaneously if we ever want to. Same shape as the canvas-doc
   * deep links agreed on in CANVAS.md.
   */
  const setUrlResearchSlug = useCallback(
    (slug: string | null) => {
      // `history.replaceState` (NOT `router.replace`) — see `setUrlSlug`
      // above for why a router navigation can cause a full page reload.
      const params = new URLSearchParams(window.location.search);
      if (slug) params.set("r", slug);
      else params.delete("r");
      const qs = params.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data)
          ? data.map((ws: { id: string; slug: string }) => ({
              id: ws.id,
              slug: ws.slug,
            }))
          : [];
        setWorkspaces(list);
      })
      .catch(() => setWorkspaces([]))
      .finally(() => setLoadingWorkspaces(false));
  }, [githubLogin]);

  // Resolve the optional `?chat=<shareId>` preload before starting
  // the conversation. Mount-only effect (deps are stable identifiers).
  useEffect(() => {
    if (!sharedChatId) {
      setChatLoadComplete(true);
      return;
    }
    let cancelled = false;
    // Read the live shared row (isShared-gated). Any org member may read
    // a shared conversation; a non-shared/private id 404s and we just
    // start a fresh empty chat.
    fetch(`/api/orgs/${githubLogin}/chat/conversations/${sharedChatId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.messages && Array.isArray(data.messages)) {
          // The DB stores `timestamp` as an ISO string; rehydrate to
          // Date so future consumers (artifacts, telemetry) get a
          // real Date instance.
          const seeded: CanvasChatMessage[] = (
            data.messages as CanvasChatMessage[]
          ).map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp as unknown as string),
          }));
          setChatInitialMessages(seeded);
        }
        if (data?.senderProfiles && typeof data.senderProfiles === "object") {
          setChatInitialSenderProfiles(data.senderProfiles);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChatLoadComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sharedChatId, githubLogin]);

  const handleHiddenChange = useCallback((entries: HiddenLiveEntry[]) => {
    const ids = new Set(
      entries.filter((e) => e.kind === "ws").map((e) => stripWsPrefix(e.id)),
    );
    setHiddenWorkspaceIds(ids);
    setHiddenInitialized(true);
  }, []);

  const chatWorkspaceSlugs = useMemo(
    () =>
      workspaces
        .filter((ws) => !hiddenWorkspaceIds.has(ws.id))
        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
        .map((ws) => ws.slug),
    [workspaces, hiddenWorkspaceIds],
  );

  // Resolve the synthetic intro's data BEFORE starting the
  // conversation so the seed messages land atomically with
  // `startConversation` (avoiding a flicker of empty chat → seed
  // populated). Skipped when resuming/joining a `?chat=` room or when
  // the user dismissed during this session.
  //
  // We wait for `hiddenInitialized` so the slug allow-list we send
  // matches what the user actually sees on the root canvas — without
  // it, attention items from a hidden workspace would leak into the
  // intro card on first paint, then jump away on the next refresh.
  useEffect(() => {
    if (sharedChatId) {
      // Resuming/joining an existing room — never inject our intro.
      setActivityLoadComplete(true);
      return;
    }
    if (!hiddenInitialized) return; // wait for the hidden-workspace list
    // Per-session dismissal. Wrapped in a try/catch because some
    // browsers throw on `sessionStorage` access in private modes.
    try {
      const dismissed = sessionStorage.getItem(
        `hive:my-activity-dismissed:${githubLogin}`,
      );
      if (dismissed === "1") {
        setActivityLoadComplete(true);
        return;
      }
    } catch {
      // Storage unavailable — fall through and just always show.
    }
    let cancelled = false;
    // User-scoped feed — no workspace slug filtering needed; the API
    // already scopes to the authenticated user across all workspaces.
    fetch(`/api/profile/activity?limit=5`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.items) && data.items.length > 0) {
          setActivityData(data.items);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setActivityLoadComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sharedChatId, githubLogin, hiddenInitialized, chatWorkspaceSlugs]);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/connections`);
      if (res.ok) {
        const data = await res.json();
        const list: ConnectionData[] = Array.isArray(data) ? data : [];
        setConnections(list);
        return list;
      }
    } catch (error) {
      console.error("Failed to fetch connections:", error);
    } finally {
      setLoadingConnections(false);
    }
    return [];
  }, [githubLogin]);

  /**
   * Open a connection inside the sidebar viewer. Both the user-click
   * path and the `?c=<slug>` deep-link path funnel through here so
   * the sidebar auto-grows consistently.
   *
   * The panel ref may be null on first paint when the deep-link
   * fetch resolves before React commits the panel — that's fine;
   * `setActiveConnection` will trigger the tab-flip effect and the
   * user can manually drag if needed. We retry once on the next
   * frame to catch the common case where the ref lands a tick later.
   */
  const openConnection = useCallback((connection: ConnectionData) => {
    const expand = () => {
      const panel = sidebarPanelRef.current;
      if (!panel) return false;
      const current = panel.getSize();
      if (preExpandSizeRef.current === null) {
        preExpandSizeRef.current = current;
      }
      if (current < SIDEBAR_EXPANDED_SIZE) {
        panel.resize(SIDEBAR_EXPANDED_SIZE);
      }
      return true;
    };
    if (!expand()) {
      // Panel not yet mounted (deep-link path) — try again next frame.
      requestAnimationFrame(() => {
        expand();
      });
    }
    setActiveConnection(connection);
    setUrlSlug(connection.slug);
  }, [setUrlSlug]);

  useEffect(() => {
    fetchConnections().then((list) => {
      const slug = searchParams.get("c");
      if (slug && list.length > 0) {
        const match = list.find((c) => c.slug === slug);
        if (match) openConnection(match);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin]);

  /**
   * `?r=<slug>` deep-link resolver. Reactive (not mount-only) so a
   * relative `?r=foo` link rendered in chat markdown — intercepted in
   * `SidebarChatMessage` and pushed via `router.replace` — opens the
   * matching research doc immediately, without a navigation.
   *
   * Resolution path: fetch the org's research list (cheap; capped by
   * project size), find the row with the matching slug, synthesize a
   * `CanvasNode` with id `research:<id>` and let `NodeDetail` →
   * `ResearchViewer` do the rendering. The Details tab auto-flips on
   * `selectedNode?.id` change (`OrgRightPanel`), so the user lands
   * directly in the viewer.
   *
   * We don't visually highlight the node on the canvas — the canvas
   * lib owns selection state via its own click events, and we don't
   * have an imperative "select this node" handle today. The UX
   * priority is "show the writeup," not "draw a halo on the card."
   *
   * Stale slug (deleted research, typo from the agent): we silently
   * drop the param — better than leaving a broken `?r=` in the URL
   * that the next refresh would also fail on.
   */
  useEffect(() => {
    const slug = searchParams.get("r");
    if (!slug) return;
    // Skip if we're already showing this research — avoids re-fetch
    // loops when the URL writer below settles after user interaction.
    if (
      selectedNode &&
      selectedNode.id.startsWith("research:") &&
      (selectedNode as { customData?: { slug?: string } }).customData?.slug ===
        slug
    ) {
      return;
    }
    let cancelled = false;
    fetch(`/api/orgs/${githubLogin}/research`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: Array<{ id: string; slug: string; topic: string }> | null) => {
        if (cancelled || !rows) return;
        const match = rows.find((row) => row.slug === slug);
        if (!match) {
          // Stale link — strip the param so refresh doesn't loop.
          setUrlResearchSlug(null);
          return;
        }
        // Synthesize a CanvasNode just rich enough for `NodeDetail`'s
        // header (text + category) and its live-id branch (the
        // `research:<id>` prefix triggers the API fetch in
        // `LiveNodeBody`, which loads the full row + extras). The
        // library's `CanvasNode` requires several layout fields we
        // don't actually use here — cast through unknown to bypass
        // the structural check rather than fabricate fake geometry.
        const synthetic: CanvasNode = {
          id: `research:${match.id}`,
          text: match.topic,
          category: "research",
          // Carry the slug through `customData` so the dedupe check
          // at the top of this effect can short-circuit re-fetches
          // when the URL settles back to the same slug (e.g.
          // `router.replace` round-trips).
          customData: { slug: match.slug },
        } as unknown as CanvasNode;
        setSelectedNode(synthetic);
      })
      .catch(() => {
        // Network blip — leave the URL alone; user can refresh.
      });
    return () => {
      cancelled = true;
    };
    // `searchParams` identity changes on every URL update; we only
    // care about the `r` param value. Reading via `.get()` keeps the
    // dep stable across unrelated URL changes (`?canvas=`, `?c=`,
    // `?chat=`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin, searchParams.get("r")]);

  const handleConnectionClick = (connection: ConnectionData) => {
    openConnection(connection);
  };

  /**
   * Close the connection viewer without touching `selectedEdge`.
   * Restores the sidebar's pre-expand width (unless the user has
   * manually resized in the meantime), clears `activeConnection`,
   * and drops the `?c=` URL slug.
   *
   * Used by both the explicit Back button (`handleBack`, which
   * additionally clears the edge) and by `handleSelectionChange`
   * when the user switches from a linked edge to an unlinked edge —
   * we want the viewer gone but the new edge to stay selected so
   * link-mode chrome appears for it.
   */
  const closeViewerKeepingEdge = useCallback(() => {
    const panel = sidebarPanelRef.current;
    const prior = preExpandSizeRef.current;
    if (panel && prior !== null) {
      const current = panel.getSize();
      // Tolerate sub-pixel rounding from `onResize` round-trips.
      if (Math.abs(current - SIDEBAR_EXPANDED_SIZE) < 0.5) {
        panel.resize(prior);
      }
    }
    preExpandSizeRef.current = null;
    setActiveConnection(null);
    setUrlSlug(null);
  }, [setUrlSlug]);

  const handleBack = () => {
    closeViewerKeepingEdge();
    // The explicit Back button (and selection-cleared / node-selected
    // paths in `handleSelectionChange`) ends the edge interaction
    // too. Without this clear, the user would be left in a state
    // with `selectedEdge` set but no visible link-mode chrome
    // (because the linked-edge link rule hides `+`/link icons),
    // which reads as "selected but invisibly so." The list-driven
    // open path leaves `selectedEdge` null already, so this is
    // safely a no-op there.
    setSelectedEdge(null);
  };

  const handleConnectionCreated = useCallback(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleConnectionDeleted = useCallback(
    (connectionId: string) => {
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
      if (activeConnection?.id === connectionId) {
        setActiveConnection(null);
        setUrlSlug(null);
      }
    },
    [activeConnection?.id, setUrlSlug],
  );

  /**
   * Read the connectionId off an edge's customData. The library type
   * doesn't include `customData` on edges, but JS round-trips extra
   * fields verbatim through the splitter (`io.ts`); the agent-side
   * tool path strips unknown fields from `add_edge`/`update_edge`
   * patches, but user-driven canvas writes flow through the lib's
   * `updateEdge` which spreads `{...edge, ...patch}` and preserves
   * `customData`. So the field exists on user-authored edges.
   */
  const readEdgeConnectionId = useCallback(
    (edge: CanvasEdge): string | null => {
      const cd = (edge as { customData?: { connectionId?: unknown } })
        .customData;
      const id = cd?.connectionId;
      return typeof id === "string" && id.length > 0 ? id : null;
    },
    [],
  );

  /**
   * Single selection-change handler. The lib's `onSelectionChange`
   * fires atomically on every state transition: node click, edge
   * click, canvas-background click (deselect), Escape, Delete,
   * navigation, stale-selection collapse. We translate the unified
   * payload into our two pieces of state (`selectedNode`,
   * `selectedEdge`) and run the edge-specific connection-open logic
   * inline.
   *
   * Edge cases:
   *
   *   - Edge with a linked connection → open the linked connection
   *     viewer (sidebar auto-grows). The edge owns the viewer for
   *     back / unlink semantics.
   *   - Edge with no connection → set edge only; the Connections
   *     tab renders link-mode chrome.
   *   - Selection cleared (`null`) → if an edge was driving an open
   *     viewer, close it. List-driven opens (no `selectedEdge`)
   *     are left alone.
   */
  const handleSelectionChange = useCallback(
    (selection: SelectionWithLabels) => {
      // Selection cleared — every path that calls this with `null`
      // (canvas-bg click, Escape, navigation, etc.) ends both kinds
      // of selection. Close an edge-owned viewer along the way, and
      // drop the `?r=` deep link if one was driving a synthesized
      // research selection (so refresh doesn't snap the user back
      // into the viewer they just navigated away from).
      if (!selection) {
        if (selectedEdge && activeConnection) handleBack();
        setSelectedEdge(null);
        setSelectedNode(null);
        setSelectedNodes([]);
        setSelectedNodesInternalEdges([]);
        if (searchParams.get("r")) setUrlResearchSlug(null);
        return;
      }
      if (selection.kind === "node") {
        setSelectedNode(selection.node);
        setSelectedNodes([]);
        setSelectedNodesInternalEdges([]);
        // Node selection clears any edge selection — and any
        // edge-owned open viewer.
        if (selectedEdge && activeConnection) handleBack();
        setSelectedEdge(null);
        // Real canvas-driven node click overrides any active
        // research deep-link unless the user clicked the same
        // research card the link pointed at.
        if (
          searchParams.get("r") &&
          !selection.node.id.startsWith("research:")
        ) {
          setUrlResearchSlug(null);
        }
        return;
      }
      if (selection.kind === "multi") {
        setSelectedNode(null);
        setSelectedEdge(null);
        setSelectedNodes(selection.nodes);
        setSelectedNodesInternalEdges(selection.internalEdges);
        // Close any edge-owned connection viewer.
        if (selectedEdge && activeConnection) handleBack();
        return;
      }
      // Edge selection.
      setSelectedNodes([]);
      setSelectedNodesInternalEdges([]);
      setSelectedNode(null);
      setSelectedEdge(selection);
      const linkedId = readEdgeConnectionId(selection.edge);
      if (linkedId) {
        const match = connections.find((c) => c.id === linkedId);
        if (match) {
          openConnection(match);
          return;
        }
        // Orphan id (connection deleted). Fall through to link-mode.
      }
      // Edge has no link (or orphaned link) — land in link-mode list.
      // Close any prior open viewer so it's not still showing, BUT
      // keep the edge we just selected (we set it on line above).
      // Calling `handleBack()` here would clobber `selectedEdge` and
      // the link-mode chrome wouldn't render for the new edge.
      if (activeConnection) closeViewerKeepingEdge();
    },
    // `handleBack` and `openConnection` are stable; pulling them in
    // as deps keeps the lint rule happy without re-creating every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedEdge, activeConnection, connections, readEdgeConnectionId],
  );

  /**
   * Link the currently-selected edge to a connection (called from
   * the link-mode list row). Writes `customData.connectionId` to the
   * edge via the imperative ref exposed by `OrgCanvasBackground`,
   * then opens the connection in the viewer so the user immediately
   * sees the result of the link. We do NOT clear `selectedEdge` —
   * the user can hit Back to return to the list with the edge still
   * in link mode (e.g. to swap the link to a different connection).
   */
  const handleLinkConnectionToEdge = useCallback(
    (connection: ConnectionData) => {
      if (!selectedEdge) return;
      const patch: EdgeUpdate = {
        ...({ customData: { connectionId: connection.id } } as EdgeUpdate),
      };
      edgePatchHandleRef.current?.(
        selectedEdge.edge.id,
        patch,
        selectedEdge.canvasRef,
      );
      // Update our local copy of the edge so future reads off
      // `selectedEdge` see the link too — without this, an unlink
      // immediately after a link would target the stale customData.
      setSelectedEdge({
        ...selectedEdge,
        edge: {
          ...selectedEdge.edge,
          ...({ customData: { connectionId: connection.id } } as Partial<CanvasEdge>),
        },
      });
      openConnection(connection);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedEdge],
  );

  /**
   * Unlink the connection from the currently-selected edge. Strips
   * `customData.connectionId` (sets `customData` to an empty object
   * so the splitter doesn't leave stale fields). Closes the viewer
   * because what's currently shown is the connection that was just
   * unlinked — the user should land back in link-mode list.
   * `selectedEdge` stays set so they can pick a different connection.
   */
  const handleUnlinkConnectionFromEdge = useCallback(() => {
    if (!selectedEdge) return;
    const patch: EdgeUpdate = {
      ...({ customData: {} } as EdgeUpdate),
    };
    edgePatchHandleRef.current?.(
      selectedEdge.edge.id,
      patch,
      selectedEdge.canvasRef,
    );
    setSelectedEdge({
      ...selectedEdge,
      edge: {
        ...selectedEdge.edge,
        ...({ customData: {} } as Partial<CanvasEdge>),
      },
    });
    handleBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge]);

  /**
   * `+ Create connection` from the link-mode header. Switches the
   * panel to the Chat tab (handled by `OrgRightPanel`) and writes a
   * prefilled draft to the chat input via the store. The user can
   * edit before sending.
   *
   * Reads labels off `selectedEdge` directly — they were resolved
   * from the canvas's node text by `OrgCanvasBackground` at click
   * time, so they're the human-readable names of whatever the
   * endpoints are (workspace name for `ws:` nodes, the user's text
   * for authored notes, etc.).
   */
  const handleCreateConnectionForEdge = useCallback(() => {
    if (!selectedEdge) return;
    const { edge, fromLabel, toLabel } = selectedEdge;
    const edgeLabel = edge.label;
    const draft = edgeLabel
      ? `Make a connection document for "${edgeLabel}" between ${fromLabel} and ${toLabel}`
      : `Make a connection document between ${fromLabel} and ${toLabel}`;
    useCanvasChatStore.getState().setPendingInputDraft(draft);
  }, [selectedEdge]);

  const handleCanvasBreadcrumbChange = useCallback((breadcrumb: string) => {
    setCurrentCanvasBreadcrumb(breadcrumb);
  }, []);

  // ─── Canvas chat conversation lifecycle ─────────────────────────────
  // Start the active conversation once everything we need is loaded.
  // Subsequent canvas-scope changes (drilling in, selecting a node)
  // update the conversation's `context` rather than recreating it.
  const [conversationStarted, setConversationStarted] = useState(false);
  const currentCanvasRef = searchParams.get("canvas") ?? "";
  const chatReady =
    !loadingWorkspaces &&
    hiddenInitialized &&
    chatLoadComplete &&
    activityLoadComplete;

  useEffect(() => {
    if (!chatReady || conversationStarted) return;

    // Build the seed: preloaded `?chat=` messages take precedence (the
    // resumed/joined conversation's prior transcript). When neither a
    // preloaded room nor attention items exist, seed is empty and we land
    // in today's
    // "Ask the agent…" empty state.
    let seedMessages: CanvasChatMessage[] | undefined =
      chatInitialMessages ?? undefined;
    let ephemeralSeedCount = 0;
    let activityArtifactId: string | null = null;

    if (!chatInitialMessages && activityData && activityData.length > 0) {
      // Synthesize the intro assistant message + register a single
      // artifact carrying the items list. Mirrors the
      // `appendAssistantError` factory pattern (id prefix + role +
      // timestamp), with `artifactIds` pointing at the registered
      // entry.
      const introId = `intro-${Date.now().toString(36)}`;
      activityArtifactId = `my-activity-${introId}`;
      useCanvasChatStore.getState().registerArtifact({
        id: activityArtifactId,
        type: "my-activity",
        // `conversationId` is unknown at this point (the conversation
        // doesn't exist yet); we set it after `startConversation`
        // returns. Renderer doesn't use it today; future canvas-side
        // subscribers may.
        conversationId: "",
        messageId: introId,
        data: { items: activityData },
      });
      const intro: CanvasChatMessage = {
        id: introId,
        role: "assistant",
        content: "Here's your recent activity:",
        timestamp: new Date(),
        artifactIds: [activityArtifactId],
      };
      seedMessages = [intro];
      ephemeralSeedCount = 1;
    }

    // Resume / join, never fork. When the URL carries `?chat=<id>` we
    // always adopt that row as our server conversation so new turns
    // append to it — whether it's our own conversation being resumed
    // after a reload or someone else's shared room we're joining. Every
    // org-canvas row is a joinable room (`isShared` defaults true), so a
    // member who opens the link reads + appends to the same row. If the
    // row is genuinely inaccessible (deleted / wrong org) the server
    // forks a fresh owned row and the send hook reconciles us to it.
    // Seeded messages (when the preload returned them) already live in
    // that row, so they all count as already-saved.
    const joinServerConversationId = sharedChatId ?? undefined;
    if (joinServerConversationId && chatInitialMessages) {
      ephemeralSeedCount = chatInitialMessages.length;
    }

    const conversationId = useCanvasChatStore.getState().startConversation(
      {
        workspaceSlug,
        workspaceSlugs: chatWorkspaceSlugs,
        orgId,
        githubLogin,
        currentCanvasRef,
        currentCanvasBreadcrumb,
        selectedNodeId: selectedNode?.id ?? null,
        selectedNodeIds: selectedNodes.map((n) => n.id),
      },
      seedMessages,
      sharedChatId ?? undefined,
      ephemeralSeedCount,
      joinServerConversationId,
    );

    // Backfill the artifact's `conversationId` now that we have one,
    // so future canvas-side selectors can scope by conversation.
    if (activityArtifactId) {
      const existing =
        useCanvasChatStore.getState().artifacts[activityArtifactId];
      if (existing) {
        useCanvasChatStore.getState().registerArtifact({
          ...existing,
          conversationId,
        });
      }
    }

    // Seed sender profiles from the preloaded ?chat= conversation so
    // SidebarChat can render attribution on non-own user messages.
    if (Object.keys(chatInitialSenderProfiles).length > 0) {
      useCanvasChatStore.getState().setSenderProfiles(conversationId, chatInitialSenderProfiles);
    }

    setConversationStarted(true);
    // Mount-once on chat-ready. Subsequent context changes go through
    // the patch effect below, not by restarting the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReady]);

  // When the user dismisses the synthetic intro (× button), persist
  // that decision for the rest of the browser session so refreshes
  // don't immediately re-seed it. Subscribes to the store rather
  // than passing a callback through the artifact data so the
  // dismissal flow stays a pure store mutation.
  useEffect(() => {
    const unsub = useCanvasChatStore.subscribe((state, prev) => {
      const before = prev.dismissedArtifactIds;
      const after = state.dismissedArtifactIds;
      if (before === after) return;
      for (const id of Object.keys(after)) {
        if (before[id]) continue;
        if (!id.startsWith("my-activity-")) continue;
        try {
          sessionStorage.setItem(
            `hive:my-activity-dismissed:${githubLogin}`,
            "1",
          );
        } catch {
          // Storage unavailable — silently swallow.
        }
      }
    });
    return () => unsub();
  }, [githubLogin]);

  // Keep the active conversation's `context` in sync with what the
  // user is currently looking at. The store does an Object.is check
  // on each field — if nothing changed, no re-render fires.
  useEffect(() => {
    if (!conversationStarted) return;
    useCanvasChatStore.getState().updateActiveContext({
      workspaceSlug,
      workspaceSlugs: chatWorkspaceSlugs,
      orgId,
      githubLogin,
      currentCanvasRef,
      currentCanvasBreadcrumb,
      selectedNodeId: selectedNode?.id ?? null,
      selectedNodeIds: selectedNodes.map((n) => n.id),
    });
  }, [
    conversationStarted,
    workspaceSlug,
    chatWorkspaceSlugs,
    orgId,
    githubLogin,
    currentCanvasRef,
    currentCanvasBreadcrumb,
    selectedNode?.id,
    selectedNodes,
  ]);

  // Mount auto-save (write-through to `chat_conversations`). Lives at
  // the page level, not inside `SidebarChat`, so tab switches and
  // chat unmounts don't lose pending saves.
  useCanvasChatAutoSave({ githubLogin });
  useSubAgentStatusRefresh({ githubLogin });

  return (
    <div ref={containerRef} className="relative flex h-full w-full overflow-hidden">
      <OrgCanvasBackground
        githubLogin={githubLogin}
        // Inset the canvas's right edge by the dynamic panel width so
        // canvas chrome (FAB, etc.) stays outside the sidebar.
        rightInset={panelWidth}
        orgName={orgName}
        onHiddenChange={handleHiddenChange}
        onSelectionChange={handleSelectionChange}
        edgePatchHandleRef={edgePatchHandleRef}
        onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
        onLinkedConnectionIdsChange={setLinkedConnectionIds}
      />

      {/* Resizable sidebar overlay — sits at z-20, absolutely
          positioned to cover the right portion of the canvas.
          The left filler panel is transparent; only the right
          ResizablePanel renders visible content.

          Stable `id`s on the group + every panel are required
          whenever `autoSaveId` is set: the library persists layout
          keyed by panel `id`, and on remount the saved layout is
          read back BEFORE the panels register. Without explicit
          ids, `useId()` generates a fresh id per mount that doesn't
          match the stored layout, the lookup throws "No group
          element found for id" and the canvas crashes. */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        <ResizablePanelGroup
          id="org-right-panel-group"
          direction="horizontal"
          autoSaveId="org-right-panel"
          className="h-full w-full"
        >
          {/* Left filler — transparent, lets canvas receive events */}
          <ResizablePanel
            id="org-right-panel-filler"
            order={1}
            defaultSize={100 - SIDEBAR_DEFAULT_SIZE}
            className="pointer-events-none"
          />

          <ResizableHandle
            withHandle
            className="pointer-events-auto"
          />

          {/* Right panel — the visible sidebar */}
          <ResizablePanel
            ref={sidebarPanelRef}
            id="org-right-panel-sidebar"
            order={2}
            defaultSize={SIDEBAR_DEFAULT_SIZE}
            minSize={SIDEBAR_MIN_SIZE}
            maxSize={SIDEBAR_MAX_SIZE}
            className="pointer-events-auto"
            onResize={(percent) => {
              const containerWidth = containerRef.current?.offsetWidth ?? 1600;
              setPanelWidth(Math.round((percent / 100) * containerWidth));
            }}
          >
            <OrgRightPanel
              githubLogin={githubLogin}
              selectedNode={selectedNode}
              selectedNodes={selectedNodes}
              selectedNodesInternalEdges={selectedNodesInternalEdges}
              chatReady={chatReady && conversationStarted}
              connections={connections}
              activeConnection={activeConnection}
              onConnectionClick={handleConnectionClick}
              onConnectionClose={handleBack}
              onConnectionCreated={handleConnectionCreated}
              onConnectionDeleted={handleConnectionDeleted}
              isLoading={loadingConnections}
              selectedEdge={selectedEdge}
              onLinkConnectionToEdge={handleLinkConnectionToEdge}
              onUnlinkConnectionFromEdge={handleUnlinkConnectionFromEdge}
              onCreateConnectionForEdge={handleCreateConnectionForEdge}
              linkedConnectionIds={linkedConnectionIds}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
