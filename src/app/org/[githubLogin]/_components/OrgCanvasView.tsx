"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CanvasNode } from "system-canvas";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OrgCanvasBackground } from "../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../connections/HiddenLivePill";
import type { ConnectionData } from "../connections/types";
import { OrgRightPanel } from "./OrgRightPanel";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "../_state/canvasChatStore";
import { useCanvasChatAutoSave } from "../_state/useCanvasChatAutoSave";
import type { AttentionItem } from "@/services/attention/topItems";
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
  const router = useRouter();
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
  const [panelWidth, setPanelWidth] = useState(384);

  const [workspaces, setWorkspaces] = useState<{ id: string; slug: string }[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenInitialized, setHiddenInitialized] = useState(false);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [activeConnection, setActiveConnection] = useState<ConnectionData | null>(null);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  /**
   * Human-readable breadcrumb for the canvas the user is currently
   * looking at. Threaded into the chat so the agent can refer to the
   * scope by name in replies.
   */
  const [currentCanvasBreadcrumb, setCurrentCanvasBreadcrumb] = useState("");

  // Optional `?chat=<shareId>` preload — the canvas's "copy share
  // link" action writes URLs of this shape; landing on one preloads
  // the conversation into a fresh forkable chat.
  const sharedChatId = searchParams.get("chat");
  const [chatInitialMessages, setChatInitialMessages] =
    useState<CanvasChatMessage[] | null>(null);
  const [chatLoadComplete, setChatLoadComplete] = useState(false);

  // Synthetic "top items needing your attention" intro — fetched
  // server-side from /api/orgs/[githubLogin]/attention. Resolved
  // before `startConversation` fires so the seed lands cleanly into
  // the new conversation. Intentionally skipped when:
  //   - `?chat=<shareId>` is present (forking — we'd be polluting
  //     someone else's transcript with the new viewer's intro).
  //   - The user dismissed the intro during this session (×).
  // See `_components/AttentionList.tsx` for the rendered card.
  const [attentionData, setAttentionData] = useState<
    { items: AttentionItem[]; total: number } | null
  >(null);
  const [attentionLoadComplete, setAttentionLoadComplete] = useState(false);

  const setUrlSlug = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (slug) params.set("c", slug);
      else params.delete("c");
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
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
    fetch(`/api/org/${githubLogin}/chat/shared/${sharedChatId}`)
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
        .map((ws) => ws.slug),
    [workspaces, hiddenWorkspaceIds],
  );

  // Resolve the synthetic intro's data BEFORE starting the
  // conversation so the seed messages land atomically with
  // `startConversation` (avoiding a flicker of empty chat → seed
  // populated). Skipped when forking a share or when the user
  // dismissed during this session.
  //
  // We wait for `hiddenInitialized` so the slug allow-list we send
  // matches what the user actually sees on the root canvas — without
  // it, attention items from a hidden workspace would leak into the
  // intro card on first paint, then jump away on the next refresh.
  useEffect(() => {
    if (sharedChatId) {
      // Forking someone else's conversation — never inject our intro.
      setAttentionLoadComplete(true);
      return;
    }
    if (!hiddenInitialized) return; // wait for the hidden-workspace list
    // Per-session dismissal. Wrapped in a try/catch because some
    // browsers throw on `sessionStorage` access in private modes.
    try {
      const dismissed = sessionStorage.getItem(
        `hive:attention-dismissed:${githubLogin}`,
      );
      if (dismissed === "1") {
        setAttentionLoadComplete(true);
        return;
      }
    } catch {
      // Storage unavailable — fall through and just always show.
    }
    let cancelled = false;
    // Restrict to workspaces visible on the root canvas. An empty
    // list still flows through as `workspaceSlugs=` so the server
    // returns zero items rather than treating the param as absent.
    const slugsQs = `&workspaceSlugs=${encodeURIComponent(chatWorkspaceSlugs.join(","))}`;
    fetch(`/api/orgs/${githubLogin}/attention?limit=3${slugsQs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.items) && data.items.length > 0) {
          setAttentionData({ items: data.items, total: data.total ?? data.items.length });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAttentionLoadComplete(true);
      });
    return () => {
      cancelled = true;
    };
    // `chatWorkspaceSlugs` identity changes whenever the visible-set
    // shifts; we want a fresh fetch in that case (e.g. user hides a
    // workspace, refreshes — new list reflects current root scope).
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

  const handleConnectionClick = (connection: ConnectionData) => {
    openConnection(connection);
  };

  const handleBack = () => {
    // Restore the sidebar to whatever width it had before we
    // auto-grew. If the user manually resized while viewing a
    // connection, respect that — only auto-restore if we're still
    // sitting at the expanded size we wrote.
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

  const handleNodeSelect = useCallback((node: CanvasNode | null) => {
    setSelectedNode(node);
  }, []);

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
    attentionLoadComplete;

  useEffect(() => {
    if (!chatReady || conversationStarted) return;

    // Build the seed: forked-share messages take precedence (those
    // are the user's prior conversation). When neither share nor
    // attention items exist, seed is empty and we land in today's
    // "Ask the agent…" empty state.
    let seedMessages: CanvasChatMessage[] | undefined =
      chatInitialMessages ?? undefined;
    let ephemeralSeedCount = 0;
    let attentionArtifactId: string | null = null;

    if (!chatInitialMessages && attentionData && attentionData.items.length > 0) {
      // Synthesize the intro assistant message + register a single
      // artifact carrying the items list. Mirrors the
      // `appendAssistantError` factory pattern (id prefix + role +
      // timestamp), with `artifactIds` pointing at the registered
      // entry.
      const introId = `intro-${Date.now().toString(36)}`;
      attentionArtifactId = `attention-${introId}`;
      useCanvasChatStore.getState().registerArtifact({
        id: attentionArtifactId,
        type: "attention-list",
        // `conversationId` is unknown at this point (the conversation
        // doesn't exist yet); we set it after `startConversation`
        // returns. Renderer doesn't use it today; future canvas-side
        // subscribers may.
        conversationId: "",
        messageId: introId,
        data: { items: attentionData.items, total: attentionData.total },
      });
      const intro: CanvasChatMessage = {
        id: introId,
        role: "assistant",
        // Singular vs plural copy. The header inside the card already
        // says "Top N for you" so the message stays short.
        content:
          attentionData.items.length === 1
            ? "Here's the top item waiting on you:"
            : `Here are the top ${attentionData.items.length} items waiting on you:`,
        timestamp: new Date(),
        artifactIds: [attentionArtifactId],
      };
      seedMessages = [intro];
      ephemeralSeedCount = 1;
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
      },
      seedMessages,
      sharedChatId ?? undefined,
      ephemeralSeedCount,
    );

    // Backfill the artifact's `conversationId` now that we have one,
    // so future canvas-side selectors can scope by conversation.
    if (attentionArtifactId) {
      const existing =
        useCanvasChatStore.getState().artifacts[attentionArtifactId];
      if (existing) {
        useCanvasChatStore.getState().registerArtifact({
          ...existing,
          conversationId,
        });
      }
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
        if (!id.startsWith("attention-")) continue;
        try {
          sessionStorage.setItem(
            `hive:attention-dismissed:${githubLogin}`,
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
  ]);

  // Mount auto-save (write-through to `chat_conversations`). Lives at
  // the page level, not inside `SidebarChat`, so tab switches and
  // chat unmounts don't lose pending saves.
  useCanvasChatAutoSave({ workspaceSlug });

  return (
    <div ref={containerRef} className="relative flex h-full w-full overflow-hidden">
      <OrgCanvasBackground
        githubLogin={githubLogin}
        // Inset the canvas's right edge by the dynamic panel width so
        // canvas chrome (FAB, etc.) stays outside the sidebar.
        rightInset={panelWidth}
        orgName={orgName}
        onHiddenChange={handleHiddenChange}
        onNodeSelect={handleNodeSelect}
        onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
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
              chatReady={chatReady && conversationStarted}
              connections={connections}
              activeConnection={activeConnection}
              onConnectionClick={handleConnectionClick}
              onConnectionClose={handleBack}
              onConnectionCreated={handleConnectionCreated}
              onConnectionDeleted={handleConnectionDeleted}
              isLoading={loadingConnections}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
