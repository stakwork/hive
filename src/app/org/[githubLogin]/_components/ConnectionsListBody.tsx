"use client";

import { useEffect } from "react";
import { Trash2, RefreshCw, Link2, Plus } from "lucide-react";
import type { CanvasEdge } from "system-canvas";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import type { ConnectionData } from "../connections/types";

interface ConnectionsListBodyProps {
  githubLogin: string;
  connections: ConnectionData[];
  activeConnectionId: string | null;
  onConnectionClick: (connection: ConnectionData) => void;
  onConnectionCreated: () => void;
  onConnectionDeleted: (connectionId: string) => void;
  isLoading: boolean;

  /**
   * The edge the user has selected on the canvas, paired with the
   * canvas ref it lives on AND resolved human labels for its
   * endpoints (set upstream by `OrgCanvasBackground` from the
   * canvas's node text). When non-null AND the edge has no linked
   * connection, the list renders in **link mode**: a small
   * `+ New connection` button sits above the rows, and every row
   * gets a link icon for picking it as the link target. When the
   * edge already has a link the user is normally in the viewer
   * (clicking a linked edge opens it directly); the list-mode
   * branch never sees a linked edge unless the user navigates back
   * \u2014 and per UX design that path also clears edge selection.
   */
  selectedEdge: {
    edge: CanvasEdge;
    canvasRef: string | undefined;
    fromLabel: string;
    toLabel: string;
  } | null;
  onLinkConnectionToEdge: (connection: ConnectionData) => void;
  onCreateConnectionForEdge: () => void;
  /**
   * Connection ids referenced by at least one edge across the canvas
   * scopes loaded this session. Rows whose connection is in this set
   * render a small dot — the sidebar-side counterpart to the canvas
   * edge color highlight, so the user can see at a glance which
   * connections are actually wired up to the diagram.
   */
  linkedConnectionIds: Set<string>;
}

/**
 * Body for the right panel's Connections tab. Renders the list of
 * connection docs and the auto-update footer; the outer panel chrome
 * (fixed positioning, tab strip) lives in `OrgRightPanel`.
 */
export function ConnectionsListBody({
  githubLogin,
  connections,
  activeConnectionId,
  onConnectionClick,
  onConnectionCreated,
  onConnectionDeleted,
  isLoading,
  selectedEdge,
  onLinkConnectionToEdge,
  onCreateConnectionForEdge,
  linkedConnectionIds,
}: ConnectionsListBodyProps) {
  // Refcounted shared subscription — see `usePusherChannel` docs for
  // why we don't call `pusher.unsubscribe` directly from this effect.
  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  useEffect(() => {
    if (!channel) return;
    const handleConnectionUpdated = () => onConnectionCreated();
    channel.bind(PUSHER_EVENTS.CONNECTION_UPDATED, handleConnectionUpdated);
    return () => {
      channel.unbind(PUSHER_EVENTS.CONNECTION_UPDATED, handleConnectionUpdated);
    };
  }, [channel, onConnectionCreated]);

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
    const parts = [
      conn.summary,
      conn.diagram,
      conn.architecture,
      conn.openApiSpec,
    ].filter(Boolean).length;
    if (parts >= 4) return null;
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        {parts}/4
      </Badge>
    );
  };

  // ─── Link mode ─────────────────────────────────────────────────────
  // The list switches into link-mode chrome only when an edge is
  // selected AND that edge has no connection linked yet. Linked
  // edges open the viewer directly (handled in the parent); the
  // list-mode branch stays clean. Endpoint labels come pre-resolved
  // on `selectedEdge` — see `OrgCanvasBackground.handleEdgeClick`.
  const linkedConnectionId = selectedEdge
    ? readEdgeConnectionId(selectedEdge.edge)
    : null;
  const linkMode = selectedEdge !== null && linkedConnectionId === null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {linkMode && (
          // Subtle right-aligned `+ New` affordance. Only visible
          // when the user has selected an edge that doesn't already
          // have a connection. Clicking switches the panel to Chat
          // with a prefilled message. The edge endpoints are
          // visible on the canvas (the edge is highlighted) — no
          // need to repeat them in the button.
          <div className="flex justify-end mb-1">
            <button
              type="button"
              onClick={onCreateConnectionForEdge}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Create a new connection for the selected edge"
            >
              <Plus className="h-3 w-3" />
              <span>New</span>
            </button>
          </div>
        )}
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
                      : "bg-muted/30 hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-muted-foreground font-mono">
                      {conn.slug}
                    </code>
                    {linkedConnectionIds.has(conn.id) && (
                      // Small dot indicating this connection is
                      // referenced by at least one edge on the
                      // canvas. Color matches `LINKED_EDGE_COLOR`
                      // in `OrgCanvasBackground` so the dot and
                      // the highlighted edge read as the same
                      // signal. Tooltip rather than a label keeps
                      // the row dense.
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: "#94a3cc" }}
                        title="Linked to an edge on the canvas"
                        aria-label="Linked to an edge on the canvas"
                      />
                    )}
                    {completionBadge(conn)}
                  </div>
                  <div className="truncate mt-0.5">{conn.name}</div>
                </button>
                {linkMode && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLinkConnectionToEdge(conn);
                    }}
                    title="Link this connection to the selected edge"
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                )}
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

      <div className="border-t p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          <span>Connections auto-update as the agent works</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Read the connectionId off an edge's customData. The library type
 * doesn't include `customData` on edges, but JS round-trips extra
 * fields through the splitter (`src/lib/canvas/io.ts`). Mirrored in
 * `OrgRightPanel` and `OrgCanvasView`; centralizing here would mean
 * a new shared module just for one accessor — kept inline pending
 * a second use site beyond the canvas surface.
 */
function readEdgeConnectionId(edge: CanvasEdge): string | null {
  const cd = (edge as { customData?: { connectionId?: unknown } }).customData;
  const id = cd?.connectionId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
