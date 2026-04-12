"use client";

import { useEffect } from "react";
import { Link2, Trash2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPusherClient, getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ConnectionData } from "./ConnectionsPage";

interface ConnectionsSidebarProps {
  githubLogin: string;
  connections: ConnectionData[];
  activeConnectionId: string | null;
  onConnectionClick: (connection: ConnectionData) => void;
  onConnectionCreated: () => void;
  onConnectionDeleted: (connectionId: string) => void;
  isLoading: boolean;
}

export function ConnectionsSidebar({
  githubLogin,
  connections,
  activeConnectionId,
  onConnectionClick,
  onConnectionCreated,
  onConnectionDeleted,
  isLoading,
}: ConnectionsSidebarProps) {

  // Subscribe to Pusher for real-time connection updates
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    const channelName = getOrgChannelName(githubLogin);
    const pusher = getPusherClient();
    const channel = pusher.subscribe(channelName);

    const handleConnectionUpdated = () => {
      onConnectionCreated(); // Re-fetch connections
    };

    channel.bind(PUSHER_EVENTS.CONNECTION_UPDATED, handleConnectionUpdated);

    return () => {
      channel.unbind(PUSHER_EVENTS.CONNECTION_UPDATED, handleConnectionUpdated);
      pusher.unsubscribe(channelName);
    };
  }, [githubLogin, onConnectionCreated]);

  const handleDelete = async (e: React.MouseEvent, connectionId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/connections`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (res.ok) {
        onConnectionDeleted(connectionId);
      }
    } catch (error) {
      console.error("Failed to delete connection:", error);
    }
  };

  const completionBadge = (conn: ConnectionData) => {
    const parts = [conn.summary, conn.diagram, conn.architecture, conn.openApiSpec].filter(Boolean).length;
    if (parts >= 4) return null; // Fully complete
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        {parts}/4
      </Badge>
    );
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 border-l bg-background flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          <span className="font-medium">Connections</span>
          <Badge variant="secondary" className="ml-1">
            {connections.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Documents describing how systems work together
        </p>
      </div>

      {/* Connection list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            <p>No connections yet.</p>
            <p className="mt-2 text-xs">
              Ask the chat to create a connection between workspaces.
            </p>
          </div>
        ) : (
          connections.map((conn) => {
            const isActive = activeConnectionId === conn.id;
            return (
              <div key={conn.id} className="group relative flex items-center gap-1">
                <button
                  onClick={() => onConnectionClick(conn)}
                  className={cn(
                    "flex-1 text-left p-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-muted/60 font-medium"
                      : "bg-muted/30 hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate">{conn.name}</span>
                    {completionBadge(conn)}
                  </div>
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => handleDelete(e, conn.id)}
                  title="Delete connection"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          <span>Connections auto-update as the agent works</span>
        </div>
      </div>
    </div>
  );
}
