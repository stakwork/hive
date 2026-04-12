"use client";

import { useEffect, useState } from "react";
import { OrgChat } from "../OrgChat";
import { ConnectionsSidebar } from "./ConnectionsSidebar";
import { ConnectionViewer } from "./ConnectionViewer";

export interface ConnectionData {
  id: string;
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
  const [workspaceSlugs, setWorkspaceSlugs] = useState<string[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [activeConnection, setActiveConnection] = useState<ConnectionData | null>(null);

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
  const fetchConnections = async () => {
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/connections`);
      if (res.ok) {
        const data = await res.json();
        setConnections(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch connections:", error);
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => {
    fetchConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin]);

  const handleConnectionClick = (connection: ConnectionData) => {
    setActiveConnection(connection);
  };

  const handleConnectionCreated = () => {
    fetchConnections();
  };

  const handleConnectionDeleted = (connectionId: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    if (activeConnection?.id === connectionId) {
      setActiveConnection(null);
    }
  };

  return (
    <div className="flex h-screen w-full">
      {/* Main content area — fills height, right-margin for sidebar */}
      <div className="flex-1 mr-80 flex flex-col h-full">
        {activeConnection ? (
          <ConnectionViewer
            connection={activeConnection}
            onBack={() => setActiveConnection(null)}
          />
        ) : loadingWorkspaces ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : workspaceSlugs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            No workspaces available.
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-end pb-4">
            <OrgChat
              workspaceSlugs={workspaceSlugs}
              githubLogin={githubLogin}
              orgId={orgId}
            />
          </div>
        )}
      </div>

      {/* Right sidebar */}
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
  );
}
