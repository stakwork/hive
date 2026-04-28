"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CanvasNode } from "system-canvas";
import { OrgChat } from "../OrgChat";
import { ConnectionViewer } from "../connections/ConnectionViewer";
import { OrgCanvasBackground } from "../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../connections/HiddenLivePill";
import type { ConnectionData } from "../connections/types";
import { OrgRightPanel } from "./OrgRightPanel";

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
 * Three layers:
 *   1. Interactive system-canvas in the background (z-0).
 *   2. Chat overlay column with `pointer-events:none` so the canvas
 *      stays draggable through it; chat input + pills re-enable
 *      interactivity on themselves.
 *   3. Right tabbed panel (z-20, w-80, fixed) — Details / Connections.
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
   * on a sub-canvas. Sourced from `OrgCanvasBackground`, which has
   * the canvas data needed to resolve a parent node's display name.
   * Threaded into the chat so the agent can refer to the scope by
   * name in replies. Empty string until the canvas reports its first
   * scope (single render gap on initial mount).
   */
  const [currentCanvasBreadcrumb, setCurrentCanvasBreadcrumb] = useState("");

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

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <OrgCanvasBackground
        githubLogin={githubLogin}
        rightInset={320}
        orgName={orgName}
        onHiddenChange={handleHiddenChange}
        onNodeSelect={handleNodeSelect}
        onCanvasBreadcrumbChange={handleCanvasBreadcrumbChange}
      />

      {/* Hide the canvas behind a connection viewer while one is open. */}
      {activeConnection && (
        <div className="absolute inset-0 bg-background z-10" aria-hidden />
      )}

      <div className="relative z-20 flex flex-1 mr-80 flex-col h-full pointer-events-none">
        {activeConnection ? (
          <div className="pointer-events-auto flex-1 flex flex-col h-full">
            <ConnectionViewer connection={activeConnection} onBack={handleBack} />
          </div>
        ) : loadingWorkspaces || !hiddenInitialized ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            No workspaces available.
          </div>
        ) : (
          // DashboardChat's root is already `pointer-events-none` and
          // each interactive surface inside (input, pill row,
          // provenance sidebar) re-enables pointer events on itself.
          // We must NOT wrap it in `pointer-events-auto`: that would
          // claim the whole chat column's bounding box and block clicks
          // on the canvas FAB that sits in the same bottom-right region.
          <div className="flex-1 flex flex-col justify-end pb-4">
            <OrgChat
              workspaceSlugs={chatWorkspaceSlugs}
              githubLogin={githubLogin}
              orgId={orgId}
              // Tell the agent what the user is looking at right now so
              // tool calls default to the right canvas scope (e.g.
              // "add a note here" while drilled into an initiative
              // sub-canvas should target that initiative, not root).
              // The ref id is the tool-call address; the breadcrumb is
              // the human-readable name the agent uses in replies.
              currentCanvasRef={searchParams.get("canvas") ?? ""}
              currentCanvasBreadcrumb={currentCanvasBreadcrumb}
              selectedNodeId={selectedNode?.id ?? null}
            />
          </div>
        )}
      </div>

      <div className="relative z-20 pointer-events-auto">
        <OrgRightPanel
          githubLogin={githubLogin}
          selectedNode={selectedNode}
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
