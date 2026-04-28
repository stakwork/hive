"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CanvasNode } from "system-canvas";
import { ConnectionViewer } from "../connections/ConnectionViewer";
import { OrgCanvasBackground } from "../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../connections/HiddenLivePill";
import type { ConnectionData } from "../connections/types";
import { OrgRightPanel } from "./OrgRightPanel";
import type { SidebarMessage } from "./SidebarChat";

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
 * The connection-viewer (when a connection doc is opened) covers the
 * canvas with an opaque overlay; the canvas keeps state behind it.
 */
export function OrgCanvasView({ githubLogin, orgId, orgName }: OrgCanvasViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

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
   * looking at — e.g. `"Acme"` on root or `"Acme › Auth Refactor"`
   * on a sub-canvas. Sourced from `OrgCanvasBackground`. Threaded
   * into the chat so the agent can refer to the scope by name in
   * replies.
   */
  const [currentCanvasBreadcrumb, setCurrentCanvasBreadcrumb] = useState("");

  // Optional `?chat=<shareId>` preload — fetches a shared
  // conversation server-side and seeds the sidebar chat with its
  // messages. The user gets a forkable conversation; their first new
  // message creates a fresh `isShared: false` row, leaving the source
  // share row untouched. Used by the canvas's "copy share link"
  // action which writes URLs of the shape `/org/<login>?chat=<id>`.
  const sharedChatId = searchParams.get("chat");
  const [chatInitialMessages, setChatInitialMessages] =
    useState<SidebarMessage[] | null>(null);
  const [chatLoadComplete, setChatLoadComplete] = useState(false);

  /**
   * Update the `?c=<slug>` URL param without changing routes. Stay on
   * the current pathname so writing the param doesn't bounce the
   * user across routes.
   */
  const setUrlSlug = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (slug) {
        params.set("c", slug);
      } else {
        params.delete("c");
      }
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

  // Resolve the optional `?chat=<shareId>` preload before mounting
  // the chat. Failure falls through to an empty conversation —
  // a broken share link shouldn't gate chat usability. Mount-only
  // effect (deps are stable identifiers); we don't re-fetch when the
  // user navigates within the canvas.
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
          // The DB stores `timestamp` as an ISO string in the JSON
          // blob; rehydrate to Date so `ChatMessage` (which doesn't
          // reach into the field today) and any future consumer get
          // a real Date instance.
          const seeded: SidebarMessage[] = (data.messages as SidebarMessage[]).map(
            (m) => ({
              ...m,
              timestamp: new Date(m.timestamp as unknown as string),
            }),
          );
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

  useEffect(() => {
    fetchConnections().then((list) => {
      const slug = searchParams.get("c");
      if (slug && list.length > 0) {
        const match = list.find((c) => c.slug === slug);
        if (match) setActiveConnection(match);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin]);

  const handleConnectionClick = (connection: ConnectionData) => {
    setActiveConnection(connection);
    setUrlSlug(connection.slug);
  };

  const handleBack = () => {
    setActiveConnection(null);
    setUrlSlug(null);
  };

  // Stable identities so child effects (notably the Pusher binding in
  // `ConnectionsListBody`) don't re-run on every parent render.
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

  // Stable so `OrgCanvasBackground`'s notify effect doesn't re-fire on
  // every parent render.
  const handleCanvasBreadcrumbChange = useCallback((breadcrumb: string) => {
    setCurrentCanvasBreadcrumb(breadcrumb);
  }, []);

  const chatReady =
    !loadingWorkspaces && hiddenInitialized && chatLoadComplete;

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <OrgCanvasBackground
        githubLogin={githubLogin}
        // Inset the canvas's right edge so the wider sidebar (`w-96`
        // = 384px) doesn't cover canvas chrome. Bumped from 320 with
        // the chat-as-sidebar move.
        rightInset={384}
        orgName={orgName}
        onHiddenChange={handleHiddenChange}
        onNodeSelect={handleNodeSelect}
        onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
      />

      {/* Hide the canvas behind a connection viewer while one is open. */}
      {activeConnection && (
        <div className="absolute inset-0 bg-background z-10" aria-hidden />
      )}

      {/* Connection viewer lives in its own z-20 layer (used to be
          nested inside the chat overlay column). `mr-96` matches the
          new sidebar width so it doesn't underlap the right panel. */}
      {activeConnection && (
        <div className="relative z-20 flex flex-1 mr-96 flex-col h-full">
          <ConnectionViewer connection={activeConnection} onBack={handleBack} />
        </div>
      )}

      <div className="relative z-20">
        <OrgRightPanel
          githubLogin={githubLogin}
          orgId={orgId}
          selectedNode={selectedNode}
          chatWorkspaceSlugs={chatWorkspaceSlugs}
          // Tell the agent what the user is looking at right now so
          // tool calls default to the right canvas scope (e.g.
          // "add a note here" while drilled into an initiative
          // sub-canvas should target that initiative, not root). The
          // ref id is the tool-call address; the breadcrumb is the
          // human-readable name the agent uses in replies.
          currentCanvasRef={searchParams.get("canvas") ?? ""}
          currentCanvasBreadcrumb={currentCanvasBreadcrumb}
          chatReady={chatReady}
          chatInitialMessages={chatInitialMessages ?? undefined}
          connections={connections}
          activeConnectionId={activeConnection?.id ?? null}
          onConnectionClick={handleConnectionClick}
          onConnectionCreated={handleConnectionCreated}
          onConnectionDeleted={handleConnectionDeleted}
          isLoading={loadingConnections}
        />
      </div>
    </div>
  );
}
