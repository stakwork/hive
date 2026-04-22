"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OrgChat } from "../OrgChat";
import { ConnectionsSidebar } from "./ConnectionsSidebar";
import { ConnectionViewer } from "./ConnectionViewer";
import { OrgCanvasBackground } from "./OrgCanvasBackground";

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
  const [workspaceSlugs, setWorkspaceSlugs] = useState<string[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
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

  // Fetch workspace slugs for the org
  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((res) => res.json())
      .then((data) => {
        const slugs = Array.isArray(data) ? data.map((ws: { slug: string }) => ws.slug) : [];
        setWorkspaceSlugs(slugs);
      })
      .catch(() => setWorkspaceSlugs([]))
      .finally(() => setLoadingWorkspaces(false));
  }, [githubLogin]);

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
        ) : loadingWorkspaces ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : workspaceSlugs.length === 0 ? (
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
          <div className="flex-1 flex flex-col justify-end pb-4">
            <OrgChat
              workspaceSlugs={workspaceSlugs}
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
