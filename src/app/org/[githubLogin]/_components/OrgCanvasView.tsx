"use client";

import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { CanvasNode } from "system-canvas";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileOrgView } from "./mobile/MobileOrgView";
import { OrgCanvasBackground, type SelectionWithLabels, type InternalEdge } from "../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../connections/HiddenLivePill";
import { OrgRightPanel } from "./OrgRightPanel";
import { useCanvasChatStore, type CanvasChatMessage, type GraphFocus } from "../_state/canvasChatStore";
import { GraphView } from "./GraphView";
import { parseArtifactRefs } from "../_state/canvasChatArtifacts";
import { useCanvasChatAutoSave } from "../_state/useCanvasChatAutoSave";
import { useGraphProposalRefresh } from "../_state/useGraphProposalRefresh";
import {
  RESIZABLE_PANEL_TRANSITION,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AttentionMapProvider } from "../connections/AttentionMapContext";
import { cn } from "@/lib/utils";
import { ChatsLayout } from "./ChatsLayout";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";
import Link from "next/link";
import { buildPageContextPath, type PageContext } from "@/lib/jamie-page-context";
import { canvasTab, orgPageView, type CanvasTab } from "./useOrgView";
import { InfiniteCanvas } from "./infinite-canvas/InfiniteCanvas";
import { OrgInitiatives } from "../OrgInitiatives";
import { useArtifactPanelOpen } from "./artifacts/useArtifactPanel";
import { useArtifactUrlParam } from "@/hooks/useArtifactUrlParam";

/** Sidebar layout sizes (percent of container width). */
const SIDEBAR_DEFAULT_SIZE = 24;
const SIDEBAR_MIN_SIZE = 16;
const SIDEBAR_MAX_SIZE = 80;

/**
 * The org page's views, from `?view=`: **chats** (the default — the chat
 * list, the chat, and the artifact pane beside it), **canvas** (the chat
 * beside it, as ever) and **graph** (the chat tucked away on the right
 * until "Ask Jamie"). Each is its own place in the org rail; a link from the old control panel
 * (`?view=control-panel`) lands on chats.
 */
type OrgPageMode = "chats" | "canvas" | "graph";
/** What fills the left panel — the canvas, the graph, the artifact panel — eases in and out. */
const LEFT_SURFACE_TRANSITION = { duration: 0.25, ease: "easeOut" } as const;

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
 * The org page — the default `/org/[githubLogin]` route.
 *
 * **Chats** (the default): the chat list (`ControlPanelList`, state from
 * `useControlPanel`), the chat as the main column, and — when a card or
 * the bar opens it — the artifact pane on the right.
 *
 * **Canvas** (`?view=canvas`) and **graph** (`?view=graph`), two layers:
 *   1. Full-bleed system-canvas (`OrgCanvasBackground`) on the left.
 *   2. Fixed-width tabbed right panel (`OrgRightPanel`) on the right
 *      with two tabs — **Chat** (`SidebarChat`, default landing
 *      tab) and **Details**.
 *
 * On the graph view the chat starts tucked away and slides in on "Ask
 * Jamie". An artifact opened from the chat takes the canvas's place
 * (`ArtifactPanel`), the chat staying beside it; closing it brings the
 * canvas back.
 *
 * This component owns the canvas chat *lifecycle*: starting the
 * active conversation in the store, keeping its `context` up to
 * date as the user navigates the canvas, preloading from
 * `?chat=<shareId>`, and mounting the auto-save subscription. The
 * conversation's *contents* (messages, loading, tool calls) live in
 * the store; `<SidebarChat />` reads them directly without prop
 * drilling.
 */
const TAB_LABEL: Record<CanvasTab, string> = { map: "Map", initiatives: "Initiatives", brainstorm: "Brainstorm" };

export function OrgCanvasView({ githubLogin, orgId, orgName }: OrgCanvasViewProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { slug: workspaceSlug } = useWorkspace();
  const isMobile = useIsMobile();

  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
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

  const [mode] = useState<OrgPageMode>(() => orgPageView(searchParams));
  // A canvas reached without `?view=canvas` (an older `?canvas=` / `?r=` link) says so in the URL,
  // so it stays the canvas — in the rail and on refresh — once the canvas clears those params.
  useEffect(() => {
    if (mode !== "canvas" || searchParams.get("view")) return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", "canvas");
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    // Mount-only: the view is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // On the graph view the chat starts hidden and slides in on "Ask Jamie".
  const [chatOpen, setChatOpen] = useState(mode !== "graph");
  /** The graph node in view — what "this" means to Jamie on the graph view. */
  const [graphFocus, setGraphFocus] = useState<GraphFocus | null>(null);
  /** The brainstorm board in view (published by the board while mounted). */
  const brainstormFocus = useCanvasChatStore((s) => s.brainstormFocus);
  /** The initiative open on the infinite canvas (published the same way). */
  const initiativeFocus = useCanvasChatStore((s) => s.initiativeFocus);
  // The panel library persists every layout; a tucked-away chat (collapsed
  // to nothing) must not become the sidebar's remembered width.
  const panelStorage = useMemo(
    () => ({
      getItem: (name: string) => {
        try {
          return localStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name: string, value: string) => {
        if (sidebarPanelRef.current?.isCollapsed()) return;
        try {
          localStorage.setItem(name, value);
        } catch {
          // Storage unavailable — the layout just won't persist.
        }
      },
    }),
    [],
  );
  // Beside the canvas or the graph, what has the left panel: that view, or
  // — over it — the artifact the chat has open.
  const artifactOpen = useArtifactPanelOpen();
  const tab = canvasTab(searchParams);
  /**
   * The infinite canvas, Jamie in a bar on it and the full chat sliding in
   * from its left; it opens artifacts in its own panel on its right.
   */
  const infiniteCanvas = mode === "canvas" && tab === "brainstorm";
  const leftSurface = artifactOpen && !infiniteCanvas ? "artifact" : mode;
  const tabHref = (next: CanvasTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "canvas");
    if (next === "map") params.delete("tab");
    else params.set("tab", next);
    // The canvas's level stays only on its own tab.
    if (next !== tab) params.delete("at");
    return `${pathname}?${params.toString()}`;
  };

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

  const [workspaces, setWorkspaces] = useState<{ id: string; slug: string; name: string; isDefault?: boolean }[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [hiddenInitialized, setHiddenInitialized] = useState(false);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<CanvasNode[]>([]);
  const [selectedNodesInternalEdges, setSelectedNodesInternalEdges] = useState<InternalEdge[]>([]);
  /**
   * Human-readable breadcrumb for the canvas the user is currently
   * looking at. Threaded into the chat so the agent can refer to the
   * scope by name in replies.
   */
  const [currentCanvasBreadcrumb, setCurrentCanvasBreadcrumb] = useState("");
  /** The same trail with refs — the path of the orchestrator's "where the user is" line. */
  const [canvasTrail, setCanvasTrail] = useState<{ label: string; ref?: string }[]>([]);

  // Optional `?chat=<conversationId>` preload. The URL tracks the live
  // conversation row (set on row creation, and what "copy share link"
  // hands out). Landing on one preloads that conversation and adopts it
  // as our server row, so we RESUME our own chat after a reload — or
  // JOIN someone else's shared room — rather than starting a fresh one.
  const sharedChatId = searchParams.get("chat");
  const [chatInitialMessages, setChatInitialMessages] = useState<CanvasChatMessage[] | null>(null);
  const [chatInitialTitle, setChatInitialTitle] = useState<string | null>(null);
  const [chatLoadComplete, setChatLoadComplete] = useState(false);

  /**
   * `?r=<research-slug>` writer — for the
   * Research viewer. Setting the slug opens the research doc in the
   * Details tab (via a synthesized `selectedNode`); clearing it drops
   * the deep link without touching the rest of the URL.
   *
   */
  const setUrlResearchSlug = useCallback(
    (slug: string | null) => {
      // `history.replaceState` (NOT `router.replace`) — a router navigation
      // can cause a full page reload. See CANVAS.md "Deep links".
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
          ? data.map((ws: { id: string; slug: string; name: string; isDefault?: boolean }) => ({
              id: ws.id,
              slug: ws.slug,
              // The graph view's workspace picker shows it.
              name: ws.name,
              // Needed by the default-first sort in `chatWorkspaceSlugs`.
              isDefault: ws.isDefault,
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
          const seeded: CanvasChatMessage[] = (data.messages as CanvasChatMessage[]).map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp as unknown as string),
            // Stored JSON, like the rest of the row, but these get rendered: keep only refs that are whole.
            artifacts: parseArtifactRefs(m.artifacts),
          }));
          setChatInitialMessages(seeded);
        }
        if (typeof data?.title === "string") {
          setChatInitialTitle(data.title);
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
    const ids = new Set(entries.filter((e) => e.kind === "ws").map((e) => stripWsPrefix(e.id)));
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
    // The chats view has no Details tab to show it in: it sends `?r=` to the canvas view (`ChatsLayout`).
    if (!slug || mode === "chats") return;
    // Skip if we're already showing this research — avoids re-fetch
    // loops when the URL writer below settles after user interaction.
    if (
      selectedNode &&
      selectedNode.id.startsWith("research:") &&
      (selectedNode as { customData?: { slug?: string } }).customData?.slug === slug
    ) {
      return;
    }
    // `html:` nodes are not deep-linked via `?r=` (research-only).
    // Clicking an html card is a normal live-id selection that
    // `NodeDetail` → `HtmlArtifactFrame` handles after the
    // node-detail fetch; no synthetic node is needed here.
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
    // dep stable across unrelated URL changes (`?canvas=`,
    // `?chat=`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin, searchParams.get("r")]);

  /**
   * Single selection-change handler. The lib's `onSelectionChange`
   * fires atomically on every state transition: node click, edge
   * click, canvas-background click (deselect), Escape, Delete,
   * navigation, stale-selection collapse. We translate the unified
   * payload into `selectedNode` / `selectedNodes`; edge selection
   * just clears both (the Details tab is node-only).
   */
  const handleSelectionChange = useCallback(
    (selection: SelectionWithLabels) => {
      // Selection cleared — drop the `?r=` deep link if one was driving a
      // synthesized research selection (so refresh doesn't snap the user
      // back into the viewer they just navigated away from).
      if (!selection) {
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
        // Real canvas-driven node click overrides any active
        // research deep-link unless the user clicked the same
        // research card the link pointed at.
        if (searchParams.get("r") && !selection.node.id.startsWith("research:")) {
          setUrlResearchSlug(null);
        }
        return;
      }
      if (selection.kind === "multi") {
        setSelectedNode(null);
        setSelectedNodes(selection.nodes);
        setSelectedNodesInternalEdges(selection.internalEdges);
        return;
      }
      // Edge selection.
      setSelectedNodes([]);
      setSelectedNodesInternalEdges([]);
      setSelectedNode(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams.get("r")],
  );

  const handleCanvasBreadcrumbChange = useCallback((breadcrumb: string, entries?: { label: string; ref?: string }[]) => {
    setCurrentCanvasBreadcrumb(breadcrumb);
    setCanvasTrail(entries ?? []);
  }, []);

  // On the graph view the chat waits, collapsed, until asked for — before
  // paint, so nothing slides away on load.
  useLayoutEffect(() => {
    if (mode === "graph") sidebarPanelRef.current?.collapse();
    // Mount-only: the view is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** "Ask Jamie" on the graph view: slide the chat in (or back out). */
  const toggleChat = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, []);

  // The panel is this page's: the store outlives the page, and an
  // artifact left open must not be the first thing the next visit shows.
  useEffect(() => () => useCanvasChatStore.getState().closeArtifactPanel(), []);
  useArtifactUrlParam();

  // ─── Canvas chat conversation lifecycle ─────────────────────────────
  // Start the active conversation once everything we need is loaded.
  // Subsequent canvas-scope changes (drilling in, selecting a node)
  // update the conversation's `context` rather than recreating it.
  const [conversationStarted, setConversationStarted] = useState(false);
  const currentCanvasRef = searchParams.get("canvas") ?? "";
  // The hidden-workspace list comes from the canvas; without a canvas to
  // report it (the chats and graph views), don't wait for it.
  const chatReady = !loadingWorkspaces && (hiddenInitialized || leftSurface !== "canvas") && chatLoadComplete;

  // What "this" means to Jamie: the canvas selection. Off the canvas it
  // isn't on screen — on the graph view `graphFocus` is "this".
  const contextNodeId = mode === "canvas" ? (selectedNode?.id ?? null) : null;
  const contextNodeIds = useMemo(
    () => (mode === "canvas" ? selectedNodes.map((n) => n.id) : []),
    [mode, selectedNodes],
  );

  // Where the user is, for the Strut orchestrator's context line: the
  // existing breadcrumb trail (canvas) topped up with the open initiative.
  const pageContext = useMemo<PageContext>(() => {
    const ws = initiativeFocus ? workspaces.find((w) => w.slug === initiativeFocus.workspaceSlug) : undefined;
    return {
      surface: "org",
      view: mode,
      ...(mode === "canvas" ? { tab } : {}),
      path: buildPageContextPath({
        orgName: orgName ?? githubLogin,
        entries: mode === "canvas" ? canvasTrail : [],
        workspace: ws ? { slug: ws.slug, name: ws.name, ref: `ws:${ws.id}` } : null,
        initiative:
          mode === "canvas" && initiativeFocus
            ? {
                ref: initiativeFocus.initiativeRefId,
                name: initiativeFocus.initiativeName,
                selectedRef: initiativeFocus.selectedRefId,
                selectedType: initiativeFocus.selectedType,
                selectedLabel: initiativeFocus.selectedLabel,
              }
            : null,
      }),
      ...(mode === "graph" && graphFocus ? { selected: [{ ref: graphFocus.refId, name: graphFocus.name, type: graphFocus.type }] } : {}),
      ...(brainstormFocus && mode === "canvas"
        ? { question: { ref: brainstormFocus.rootRefId, text: brainstormFocus.rootText } }
        : {}),
    };
  }, [mode, tab, canvasTrail, workspaces, initiativeFocus, brainstormFocus, graphFocus, orgName, githubLogin]);

  useEffect(() => {
    if (!chatReady || conversationStarted) return;

    // Build the seed: preloaded `?chat=` messages take precedence (the
    // resumed/joined conversation's prior transcript). When neither a
    // preloaded room nor attention items exist, seed is empty and we land
    // in today's
    // "Ask the agent…" empty state.
    let seedMessages: CanvasChatMessage[] | undefined = chatInitialMessages ?? undefined;
    let ephemeralSeedCount = 0;

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

    useCanvasChatStore.getState().startConversation(
      {
        workspaceSlug,
        workspaceSlugs: chatWorkspaceSlugs,
        orgId,
        githubLogin,
        currentCanvasRef,
        currentCanvasBreadcrumb,
        selectedNodeId: contextNodeId,
        selectedNodeIds: contextNodeIds,
        graphFocus,
        pageContext,
      },
      seedMessages,
      sharedChatId ?? undefined,
      ephemeralSeedCount,
      joinServerConversationId,
      chatInitialTitle,
    );

    setConversationStarted(true);
    // Mount-once on chat-ready. Subsequent context changes go through
    // the patch effect below, not by restarting the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatReady]);

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
      selectedNodeId: contextNodeId,
      selectedNodeIds: contextNodeIds,
      graphFocus,
      brainstormFocus,
      initiativeFocus,
      pageContext,
    });
  }, [
    conversationStarted,
    workspaceSlug,
    chatWorkspaceSlugs,
    orgId,
    githubLogin,
    currentCanvasRef,
    currentCanvasBreadcrumb,
    contextNodeId,
    contextNodeIds,
    graphFocus,
    brainstormFocus,
    initiativeFocus,
    pageContext,
  ]);

  // Mount auto-save (write-through to `chat_conversations`). Lives at
  // the page level, not inside `SidebarChat`, so tab switches and
  // chat unmounts don't lose pending saves.
  useCanvasChatAutoSave({ githubLogin });
  useGraphProposalRefresh();

  const rightPanel = (onShowList?: () => void, onCollapse?: () => void) => (
    <OrgRightPanel
      githubLogin={githubLogin}
      selectedNode={selectedNode}
      selectedNodes={selectedNodes}
      selectedNodesInternalEdges={selectedNodesInternalEdges}
      chatReady={chatReady && conversationStarted}
      chatsView={mode === "chats" || infiniteCanvas ? { onShowList } : undefined}
      onCollapse={onCollapse}
    />
  );

  // On a phone the same lifecycle above drives one screen instead of the resizable panels.
  if (isMobile) {
    return (
      <AttentionMapProvider githubLogin={githubLogin} visibleWorkspaceSlugs={chatWorkspaceSlugs}>
        <MobileOrgView
          mode={mode}
          githubLogin={githubLogin}
          orgName={orgName}
          chatReady={chatReady && conversationStarted}
          workspaces={workspaces}
          loadingWorkspaces={loadingWorkspaces}
          onHiddenChange={handleHiddenChange}
          onGraphFocusChange={setGraphFocus}
        />
      </AttentionMapProvider>
    );
  }

  return (
    <AttentionMapProvider githubLogin={githubLogin} visibleWorkspaceSlugs={chatWorkspaceSlugs}>
      <div ref={containerRef} className="relative flex h-full w-full overflow-hidden">
        {mode === "chats" ? (
          <ChatsLayout githubLogin={githubLogin} renderChat={rightPanel} />
        ) : (
          <>
            {/* The canvas, under the panel group. An open artifact takes its place
          (the canvas unmounts) and gives it back on close. */}
            <AnimatePresence initial={false}>
              {leftSurface === "canvas" && (
                <motion.div
                  key="canvas"
                  // `isolate` contains the canvas's own overlays (Live Now, hidden-live pill, FAB…)
                  // in this layer, so the initiatives surface and the tab control sit above them.
                  className={cn("absolute inset-x-0 bottom-0 z-0 flex isolate", mode === "canvas" ? "top-11" : "top-0")}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <OrgCanvasBackground
                    githubLogin={githubLogin}
                    // Inset the canvas's right edge by the dynamic panel width so
                    // canvas chrome (FAB, etc.) stays outside the sidebar.
                    rightInset={panelWidth}
                    orgName={orgName}
                    onHiddenChange={handleHiddenChange}
                    onSelectionChange={handleSelectionChange}
                    onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {mode === "canvas" && leftSurface === "canvas" && (
              <>
                {tab === "initiatives" && (
                  <div
                    className="absolute bottom-0 left-0 top-11 z-10 overflow-y-auto bg-background"
                    style={{ right: panelWidth }}
                  >
                    <div className="max-w-4xl mx-auto px-6 py-6 w-full">
                      <OrgInitiatives githubLogin={githubLogin} />
                    </div>
                  </div>
                )}
                {infiniteCanvas && (
                  <div className="absolute bottom-0 left-0 right-0 top-11 z-10 overflow-hidden bg-background">
                    <InfiniteCanvas
                      githubLogin={githubLogin}
                      workspaceSlugs={chatWorkspaceSlugs}
                      renderChat={(onCollapse) => rightPanel(undefined, onCollapse)}
                    />
                  </div>
                )}
                {/* The tab bar lines up with the chat panel's header across the divider. */}
                <div
                  role="tablist"
                  aria-label="Canvas view"
                  className="absolute left-0 top-0 z-30 flex h-11 items-stretch border-b bg-background pl-1 text-sm"
                  style={{ right: infiniteCanvas ? 0 : panelWidth }}
                >
                  {(["map", "initiatives", "brainstorm"] as const).map((t) => (
                    <Link
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      href={tabHref(t)}
                      replace
                      className={cn(
                        "-mb-px flex items-center border-b-2 px-4 font-medium transition-colors",
                        tab === t
                          ? "border-foreground text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {TAB_LABEL[t]}
                    </Link>
                  ))}
                </div>
              </>
            )}

            {/* Resizable sidebar overlay — sits at z-20, absolutely
          positioned to cover the right portion of the canvas.
          The left filler panel is transparent over the canvas; only the
          right ResizablePanel renders visible content.

          Stable `id`s on the group + every panel are required
          whenever `autoSaveId` is set: the library persists layout
          keyed by panel `id`, and on remount the saved layout is
          read back BEFORE the panels register. Without explicit
          ids, `useId()` generates a fresh id per mount that doesn't
          match the stored layout, the lookup throws "No group
          element found for id" and the canvas crashes. */}
            {/* On the infinite canvas Jamie is a bar on it, the full chat sliding in from its left. */}
            {!infiniteCanvas && (
            <div className="absolute inset-0 z-20 pointer-events-none">
              <ResizablePanelGroup
                id="org-right-panel-group"
                direction="horizontal"
                autoSaveId="org-right-panel"
                storage={panelStorage}
                className="h-full w-full"
              >
                {/* Left: transparent over the canvas, the graph, or — over
              either — the artifact the chat has open. One surface eases
              out while the next eases in. */}
                <ResizablePanel
                  id="org-right-panel-filler"
                  order={1}
                  defaultSize={100 - SIDEBAR_DEFAULT_SIZE}
                  className={cn(
                    "relative",
                    leftSurface === "canvas" ? "pointer-events-none" : "pointer-events-auto",
                    RESIZABLE_PANEL_TRANSITION,
                  )}
                >
                  <AnimatePresence initial={false}>
                    {leftSurface === "artifact" ? (
                      <motion.div
                        key="artifact"
                        className="absolute inset-0 bg-background"
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 24 }}
                        transition={LEFT_SURFACE_TRANSITION}
                      >
                        <ArtifactPanel />
                      </motion.div>
                    ) : leftSurface === "graph" ? (
                      <motion.div
                        key="graph"
                        className="absolute inset-0 bg-background"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={LEFT_SURFACE_TRANSITION}
                      >
                        <GraphView
                          workspaces={workspaces}
                          loading={loadingWorkspaces}
                          chatOpen={chatOpen}
                          onToggleChat={toggleChat}
                          onFocusChange={setGraphFocus}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  // Nothing to drag while the graph view's chat is tucked away.
                  className={cn("pointer-events-auto", mode === "graph" && !chatOpen && "hidden")}
                />

                {/* Right panel — the chat; on the graph view, tucked away until "Ask Jamie". */}
                <ResizablePanel
                  ref={sidebarPanelRef}
                  id="org-right-panel-sidebar"
                  order={2}
                  defaultSize={SIDEBAR_DEFAULT_SIZE}
                  minSize={SIDEBAR_MIN_SIZE}
                  maxSize={SIDEBAR_MAX_SIZE}
                  // Only the graph view tucks the chat away entirely.
                  collapsible={mode === "graph"}
                  collapsedSize={0}
                  onCollapse={() => setChatOpen(false)}
                  onExpand={() => setChatOpen(true)}
                  className={cn("pointer-events-auto", RESIZABLE_PANEL_TRANSITION)}
                  onResize={(percent) => {
                    const containerWidth = containerRef.current?.offsetWidth ?? 1600;
                    setPanelWidth(Math.round((percent / 100) * containerWidth));
                  }}
                >
                  {rightPanel()}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            )}
          </>
        )}
      </div>
    </AttentionMapProvider>
  );
}
