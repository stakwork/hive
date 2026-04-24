"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrgChat } from "../OrgChat";
import { ConnectionsSidebar } from "./ConnectionsSidebar";
import { ConnectionViewer } from "./ConnectionViewer";
import { OrgCanvasBackground } from "./OrgCanvasBackground";
import type { HiddenLiveEntry } from "./HiddenLivePill";

/** Strip the `ws:` prefix from a live workspace id. */
function stripWsPrefix(liveId: string): string {
  return liveId.startsWith("ws:") ? liveId.slice(3) : liveId;
}

export interface ConnectionData {
  id: string;
  slug: string;
  name: string;
  summary: string;
  diagram: string | null;
  architecture: string | null;
  openApiSpec: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionsPageProps {
  githubLogin: string;
  orgId: string;
  orgName: string | null;
}

export function ConnectionsPage({ githubLogin, orgId, orgName }: ConnectionsPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * All workspaces in the org the user has access to. We keep both
   * `id` and `slug` because the canvas expresses "hidden" with
   * `ws:<id>` while the chat takes slugs; having both lets us bridge
   * without refetching.
   */
  const [workspaces, setWorkspaces] = useState<{ id: string; slug: string }[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  /**
   * Hidden workspace ids (raw, without the `ws:` prefix). Populated
   * from the canvas's hidden-list and kept live via `OrgCanvasBackground`'s
   * `onHiddenChange`. Used to filter the chat's default context set so
   * "hidden on canvas" and "default-in-chat-context" stay aligned.
   */
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  /**
   * The canvas's `onHiddenChange` fires once after its initial fetch
   * resolves. We gate the chat's first mount on this so the seed for
   * `defaultExtraWorkspaceSlugs` is already filtered — `DashboardChat`
   * only reads that prop on mount (by design, so user pill edits
   * aren't clobbered), so mounting too early would leak hidden
   * workspaces into the default set until the next fresh chat.
   */
  const [hiddenInitialized, setHiddenInitialized] = useState(false);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [activeConnection, setActiveConnection] = useState<ConnectionData | null>(null);

  const setUrlSlug = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (slug) {
        params.set("c", slug);
      } else {
        params.delete("c");
      }
      router.replace(`/org/${githubLogin}/connections?${params.toString()}`, { scroll: false });
    },
    [router, githubLogin, searchParams]
  );

  // Fetch workspaces for the org.
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

  /**
   * Fires from `OrgCanvasBackground` on every hidden-list change
   * (initial load, user hide/restore, Pusher refresh). We reduce to
   * just workspace ids — feature/repo hides aren't part of the chat
   * context story.
   */
  const handleHiddenChange = useCallback((entries: HiddenLiveEntry[]) => {
    const ids = new Set(
      entries.filter((e) => e.kind === "ws").map((e) => stripWsPrefix(e.id)),
    );
    setHiddenWorkspaceIds(ids);
    setHiddenInitialized(true);
  }, []);

  /**
   * Workspace slugs passed to the chat as default context. Recompute
   * whenever the workspace list or the hidden set changes. "Hidden on
   * the canvas" means "not part of the default chat context" — the
   * user can still opt back in via the chat's own pill row.
   */
  const chatWorkspaceSlugs = useMemo(
    () =>
      workspaces
        .filter((ws) => !hiddenWorkspaceIds.has(ws.id))
        .map((ws) => ws.slug),
    [workspaces, hiddenWorkspaceIds],
  );

  // Fetch connections for the org
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

  // Initial load: fetch connections then resolve URL slug
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

  const handleConnectionCreated = () => {
    fetchConnections();
  };

  const handleConnectionDeleted = (connectionId: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    if (activeConnection?.id === connectionId) {
      setActiveConnection(null);
      setUrlSlug(null);
    }
  };

  // Interactive system-canvas background. Lives in absolute layer behind
  // the chat + sidebar so pan/zoom/edit happens wherever the UI doesn't
  // occlude it. The overlay layer below uses pointer-events:none by
  // default; each real UI surface re-enables them on itself.
  return (
    <div className="relative flex h-screen w-full overflow-hidden">
      <OrgCanvasBackground
        githubLogin={githubLogin}
        rightInset={320}
        orgName={orgName}
        onHiddenChange={handleHiddenChange}
      />

      {/* Hide the background entirely while a specific connection is open —
          that view has its own dense UI and shouldn't sit over the canvas. */}
      {activeConnection && (
        <div className="absolute inset-0 bg-background z-10" aria-hidden />
      )}

      <div className="relative z-20 flex flex-1 mr-80 flex-col h-full pointer-events-none">
        {activeConnection ? (
          <div className="pointer-events-auto flex-1 flex flex-col h-full">
            <ConnectionViewer
              connection={activeConnection}
              onBack={handleBack}
            />
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
          // DashboardChat's root is already `pointer-events-none` and each
          // interactive surface inside (input, pill row, provenance sidebar)
          // re-enables pointer events on itself. We must NOT wrap it in a
          // `pointer-events-auto` div: that would claim the whole chat
          // column's bounding box and block clicks on the canvas FAB that
          // sits in the same bottom-right region.
          //
          // `chatWorkspaceSlugs` excludes any workspace hidden on the
          // canvas — hiding a workspace card removes it from both
          // surfaces at once, restoring puts it back.
          <div className="flex-1 flex flex-col justify-end pb-4">
            <OrgChat
              workspaceSlugs={chatWorkspaceSlugs}
              githubLogin={githubLogin}
              orgId={orgId}
            />
          </div>
        )}
      </div>

      {/* Right sidebar — opaque, always interactive */}
      <div className="relative z-20 pointer-events-auto">
        <ConnectionsSidebar
          githubLogin={githubLogin}
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
