"use client";

import { useEffect, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MousePointerClick } from "lucide-react";
import { NodeDetail } from "./NodeDetail";
import { ConnectionsListBody } from "./ConnectionsListBody";
import { SidebarChat, type SidebarMessage } from "./SidebarChat";
import type { ConnectionData } from "../connections/types";

type Tab = "chat" | "details" | "connections";

interface OrgRightPanelProps {
  githubLogin: string;
  orgId: string;
  selectedNode: CanvasNode | null;
  // Chat tab inputs — passed straight to <SidebarChat />.
  chatWorkspaceSlugs: string[];
  currentCanvasRef: string;
  currentCanvasBreadcrumb: string;
  /**
   * True once workspaces + initial hidden list have loaded AND the
   * optional `?chat=<shareId>` preload has resolved (success or
   * fail). While false, the chat tab renders a spinner so we don't
   * mount with a half-loaded preload or with `workspaceSlugs` empty
   * before the hidden filter arrives.
   */
  chatReady: boolean;
  /** Preloaded messages from a `?chat=<shareId>` deep link. */
  chatInitialMessages?: SidebarMessage[];
  connections: ConnectionData[];
  activeConnectionId: string | null;
  onConnectionClick: (connection: ConnectionData) => void;
  onConnectionCreated: () => void;
  onConnectionDeleted: (connectionId: string) => void;
  isLoading: boolean;
}

/**
 * Tabbed right sidebar for the canvas view. Three tabs:
 *
 * - **Chat** — `<SidebarChat />`. The default landing tab; the
 *   agent's home base on the canvas page.
 * - **Details** — node summary (description + kind-specific extras
 *   + deep links). Auto-selected when the user clicks a node.
 * - **Connections** — the connection-doc list.
 *
 * Switching tabs is purely panel-local; canvas selection state is
 * unaffected, so the user can flip back and forth without losing
 * which node they were inspecting.
 */
export function OrgRightPanel({
  githubLogin,
  orgId,
  selectedNode,
  chatWorkspaceSlugs,
  currentCanvasRef,
  currentCanvasBreadcrumb,
  chatReady,
  chatInitialMessages,
  connections,
  activeConnectionId,
  onConnectionClick,
  onConnectionCreated,
  onConnectionDeleted,
  isLoading,
}: OrgRightPanelProps) {
  // Default to Chat — the canvas's primary agent surface. Auto-flip
  // to Details when the user clicks a node. Manual tab clicks
  // override this until the next selection change. Keying on
  // `selectedNode?.id` (not the object identity) so reselecting the
  // same node from elsewhere on the canvas still re-fires the flip.
  const [tab, setTab] = useState<Tab>("chat");
  useEffect(() => {
    if (selectedNode) setTab("details");
    // Keying on `selectedNode?.id` (not `selectedNode`) so the canvas
    // re-emitting the same node object on reselect still re-fires
    // the flip-to-Details. The lint rule wants us to depend on the
    // whole object, but that would also re-fire on every parent
    // render that produces a new wrapper — which is the behavior we
    // explicitly don't want here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 border-l bg-background flex flex-col">
      <div className="flex items-stretch border-b text-sm">
        <TabButton
          label="Chat"
          isActive={tab === "chat"}
          onClick={() => setTab("chat")}
        />
        <TabButton
          label="Details"
          isActive={tab === "details"}
          onClick={() => setTab("details")}
          disabled={!selectedNode}
        />
        <TabButton
          label="Connections"
          isActive={tab === "connections"}
          onClick={() => setTab("connections")}
          trailing={
            <Badge variant="secondary" className="ml-1">
              {connections.length}
            </Badge>
          }
        />
      </div>

      <div className="flex-1 min-h-0">
        {tab === "chat" ? (
          chatReady ? (
            <SidebarChat
              githubLogin={githubLogin}
              orgId={orgId}
              workspaceSlugs={chatWorkspaceSlugs}
              currentCanvasRef={currentCanvasRef}
              currentCanvasBreadcrumb={currentCanvasBreadcrumb}
              selectedNodeId={selectedNode?.id ?? null}
              initialMessages={chatInitialMessages}
            />
          ) : (
            <ChatLoadingState />
          )
        ) : tab === "details" ? (
          selectedNode ? (
            <NodeDetail node={selectedNode} githubLogin={githubLogin} />
          ) : (
            <EmptyDetailsHint />
          )
        ) : (
          <ConnectionsListBody
            githubLogin={githubLogin}
            connections={connections}
            activeConnectionId={activeConnectionId}
            onConnectionClick={onConnectionClick}
            onConnectionCreated={onConnectionCreated}
            onConnectionDeleted={onConnectionDeleted}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
  disabled,
  trailing,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 px-3 py-2.5 font-medium transition-colors flex items-center justify-center gap-1.5",
        "border-b-2 -mb-[1px]",
        isActive
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed hover:text-muted-foreground",
      )}
    >
      {label}
      {trailing}
    </button>
  );
}

function ChatLoadingState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

function EmptyDetailsHint() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center text-muted-foreground">
      <MousePointerClick className="h-6 w-6 mb-3 opacity-60" />
      <p className="text-sm">Click a node to see details.</p>
      <p className="text-xs mt-2 opacity-70">
        Workspaces, initiatives, milestones, and notes all show their
        summary here.
      </p>
    </div>
  );
}
