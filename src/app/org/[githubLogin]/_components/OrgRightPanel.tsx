"use client";

import { useEffect, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MousePointerClick } from "lucide-react";
import { NodeDetail } from "./NodeDetail";
import { ConnectionsListBody } from "./ConnectionsListBody";
import type { ConnectionData } from "../connections/types";

type Tab = "details" | "connections";

interface OrgRightPanelProps {
  githubLogin: string;
  selectedNode: CanvasNode | null;
  connections: ConnectionData[];
  activeConnectionId: string | null;
  onConnectionClick: (connection: ConnectionData) => void;
  onConnectionCreated: () => void;
  onConnectionDeleted: (connectionId: string) => void;
  isLoading: boolean;
}

/**
 * Tabbed right sidebar for the canvas view. Two tabs:
 *
 * - **Details** — node summary (description + kind-specific extras +
 *   deep links). Auto-selected when the user clicks a node.
 * - **Connections** — the connection-doc list. The default landing
 *   tab when nothing is selected.
 *
 * Switching tabs is purely panel-local; canvas selection state is
 * unaffected, so the user can flip back and forth without losing
 * which node they were inspecting.
 */
export function OrgRightPanel({
  githubLogin,
  selectedNode,
  connections,
  activeConnectionId,
  onConnectionClick,
  onConnectionCreated,
  onConnectionDeleted,
  isLoading,
}: OrgRightPanelProps) {
  // Default to Connections when nothing is selected; auto-flip to
  // Details when the user clicks a node on the canvas. Manual tab
  // clicks override this until the next selection change.
  const [tab, setTab] = useState<Tab>("connections");
  useEffect(() => {
    if (selectedNode) setTab("details");
  }, [selectedNode]);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 border-l bg-background flex flex-col">
      <div className="flex items-stretch border-b text-sm">
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
        {tab === "details" ? (
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
