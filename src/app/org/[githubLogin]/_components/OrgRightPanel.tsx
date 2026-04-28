"use client";

import { useEffect, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MousePointerClick } from "lucide-react";
import { NodeDetail } from "./NodeDetail";
import { ConnectionsListBody } from "./ConnectionsListBody";
import { SidebarChat } from "./SidebarChat";
import type { ConnectionData } from "../connections/types";

type Tab = "chat" | "details" | "connections";

interface OrgRightPanelProps {
  githubLogin: string;
  selectedNode: CanvasNode | null;
  /**
   * True once the canvas chat conversation has been initialized in
   * the store (workspaces loaded + hidden list ready + optional
   * `?chat=<shareId>` preload resolved). While false, the chat tab
   * renders a spinner. The conversation itself lives in the store —
   * no per-conversation props flow through this panel.
   */
  chatReady: boolean;
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
 * - **Details** — node summary. Auto-selected when a node is clicked.
 * - **Connections** — the connection-doc list.
 *
 * **All three tabs stay mounted.** Inactive tabs are hidden via the
 * `hidden` attribute rather than unmounted. This is load-bearing for
 * `<SidebarChat />`: even though chat state lives in the canvas chat
 * store (so tab switches wouldn't *lose* state), keeping the
 * component mounted preserves things like scroll position, input
 * focus, in-flight streaming, and any future imperative refs without
 * needing to plumb them through the store. It also prevents a
 * remount-storm when the user pings between Chat and Details.
 */
export function OrgRightPanel({
  githubLogin,
  selectedNode,
  chatReady,
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
  // `selectedNode?.id` (not the object identity) so the canvas
  // re-emitting the same node object on reselect still re-fires.
  const [tab, setTab] = useState<Tab>("chat");
  useEffect(() => {
    if (selectedNode) setTab("details");
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

      <div className="flex-1 min-h-0 relative">
        {/* Chat tab — always mounted, hidden when inactive. */}
        <TabBody hidden={tab !== "chat"}>
          {chatReady ? (
            <SidebarChat githubLogin={githubLogin} />
          ) : (
            <ChatLoadingState />
          )}
        </TabBody>

        {/* Details tab — also kept mounted so node-detail fetches
            don't restart when the user flips back. */}
        <TabBody hidden={tab !== "details"}>
          {selectedNode ? (
            <NodeDetail node={selectedNode} githubLogin={githubLogin} />
          ) : (
            <EmptyDetailsHint />
          )}
        </TabBody>

        {/* Connections tab — kept mounted to preserve its Pusher
            subscription and avoid re-fetching the connection list on
            every tab flip. */}
        <TabBody hidden={tab !== "connections"}>
          <ConnectionsListBody
            githubLogin={githubLogin}
            connections={connections}
            activeConnectionId={activeConnectionId}
            onConnectionClick={onConnectionClick}
            onConnectionCreated={onConnectionCreated}
            onConnectionDeleted={onConnectionDeleted}
            isLoading={isLoading}
          />
        </TabBody>
      </div>
    </div>
  );
}

/**
 * A tab body that's always mounted but visually hidden when
 * `hidden`. Uses `hidden` (the HTML attribute, which `display: none`s
 * the element) so off-screen tabs cost zero layout but keep their
 * React state. Cheaper and less surprising than `display: none`
 * via Tailwind classes — the `hidden` attribute also short-circuits
 * the accessibility tree.
 */
function TabBody({
  hidden,
  children,
}: {
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <div hidden={hidden} className={hidden ? "" : "absolute inset-0"}>
      {children}
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
