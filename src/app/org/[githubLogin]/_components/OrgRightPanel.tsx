"use client";

import { useEffect, useState } from "react";
import type { CanvasEdge, CanvasNode } from "system-canvas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Layers, MousePointerClick, Network } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { NodeDetail } from "./NodeDetail";
import { MultiNodeDetail } from "./MultiNodeDetail";
import { ConnectionsListBody } from "./ConnectionsListBody";
import { SidebarChat, SidebarChatActions } from "./SidebarChat";
import { ConnectionViewer } from "../connections/ConnectionViewer";
import type { ConnectionData } from "../connections/types";
import type { InternalEdge } from "../connections/OrgCanvasBackground";
import { useAutomationInbox, type InboxRun } from "../_state/useAutomationInbox";
import { formatRelativeTime } from "./CanvasHistoryPopover";
import {
  ControlPanelBriefing,
  PlanStage,
  focusForAttentionItem,
  taskNodeFor,
  type ControlPanelStageProps,
} from "./control-panel/ControlPanelStage";
import type { ControlPanelFocus } from "./control-panel/types";
import { ActionTip } from "./ActionTip";

type Tab = "chat" | "details" | "connections";

/** The plan/task on (or last on) the control panel's stage, with the workspace its page needs. */
interface StageDetail {
  focus: ControlPanelFocus;
  workspace: { id: string; slug: string } | null;
}

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
  /**
   * The currently-open connection, or null when no connection is
   * being viewed. When non-null, the Connections tab body switches
   * from the list view to the inline `<ConnectionViewer />`. The
   * sidebar has been auto-grown by `OrgCanvasView` so the viewer has
   * room.
   */
  activeConnection: ConnectionData | null;
  onConnectionClick: (connection: ConnectionData) => void;
  /** Called when the user hits Back inside the inline viewer. */
  onConnectionClose: () => void;
  onConnectionCreated: () => void;
  onConnectionDeleted: (connectionId: string) => void;
  isLoading: boolean;

  /**
   * The edge the user has selected on the canvas, paired with the
   * canvas ref it lives on AND the resolved human labels for its
   * endpoints. When non-null, the Connections tab body renders
   * link-mode chrome — a sticky header strip showing the selected
   * edge's endpoint labels + link icons on every list row + a
   * `+ Create` button — and the viewer renders an Unlink affordance
   * next to Back when an edge-linked connection is open.
   *
   * Mutually exclusive with `selectedNode` from the user's POV; the
   * Details tab continues to be node-only.
   */
  selectedEdge: {
    edge: CanvasEdge;
    canvasRef: string | undefined;
    fromLabel: string;
    toLabel: string;
  } | null;
  /** Link the currently-selected edge to a connection (list-row click). */
  onLinkConnectionToEdge: (connection: ConnectionData) => void;
  /** Strip the link from the currently-selected edge (viewer button). */
  onUnlinkConnectionFromEdge: () => void;
  /**
   * Switch to the Chat tab and prefill the input with a message
   * proposing a new connection between the edge's endpoints. The
   * parent reads the from/to labels off its own `selectedEdge`
   * state — no args needed.
   */
  onCreateConnectionForEdge: () => void;
  /**
   * Connection ids referenced by at least one edge on the canvas
   * (across every canvas scope loaded this session). Used by the
   * Connections list to render a small dot next to rows whose
   * connection is wired up — the sidebar-side mirror of the canvas's
   * linked-edge color highlight.
   */
  linkedConnectionIds: Set<string>;
  selectedNodes: CanvasNode[];
  selectedNodesInternalEdges: InternalEdge[];
  /**
   * Control panel mode: this panel is the stage. The tab strip gives way
   * to the briefing, and what shows follows the control panel's focus —
   * the Jamie chat (the same mounted `<SidebarChat>`, so switching views
   * never remounts it) or a plan/task through `NodeDetail`, as the
   * Details tab renders a canvas node.
   */
  controlPanel?: ControlPanelStageProps;
  /** Switch the org page to the control panel (the chat grows into its stage). */
  onOpenControlPanel: () => void;
}

/**
 * Tabbed right sidebar for the canvas view. Three tabs:
 *
 * - **Chat** — `<SidebarChat />`. The default landing tab; the
 *   agent's home base on the canvas page.
 * - **Details** — node summary. Auto-selected when a node is clicked.
 * - **Connections** — the connection-doc list.
 *
 * One bar in both views: tabs on the left, the chat's actions (`SidebarChatActions`,
 * the chat itself renders headerless) and the canvas ⇄ control panel toggle on
 * the right. In control panel mode (`controlPanel` set) the same panel is the
 * stage: Chat and Details follow, and set, what is on stage; Connections and
 * the inbox badge step aside; the briefing sits under the bar; a plan is the
 * real plan page.
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
  selectedNodes,
  selectedNodesInternalEdges,
  chatReady,
  connections,
  activeConnection,
  onConnectionClick,
  onConnectionClose,
  onConnectionCreated,
  onConnectionDeleted,
  isLoading,
  selectedEdge,
  onLinkConnectionToEdge,
  onUnlinkConnectionFromEdge,
  onCreateConnectionForEdge,
  linkedConnectionIds,
  controlPanel,
  onOpenControlPanel,
}: OrgRightPanelProps) {
  // Default to Chat — the canvas's primary agent surface. Auto-flip
  // to Details when the user clicks a node, to Connections when a
  // connection is opened or an edge is selected. Manual tab clicks
  // override this until the next trigger. Keying on
  // `selectedNode?.id` / `activeConnection?.id` / `selectedEdge.edge.id`
  // (not the object identity) so the canvas re-emitting the same
  // object on reselect still re-fires.
  const [tab, setTab] = useState<Tab>("chat");
  const [inboxOpen, setInboxOpen] = useState(false);

  useEffect(() => {
    if (selectedNode) setTab("details");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);
  useEffect(() => {
    if (selectedNodes.length >= 2) setTab("details");
  }, [selectedNodes.length]);
  useEffect(() => {
    if (activeConnection) setTab("connections");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection?.id]);
  useEffect(() => {
    if (selectedEdge) setTab("connections");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge?.edge.id]);

  const { count, runs, openRun } = useAutomationInbox(githubLogin, { chatReady });

  // On the control panel what shows follows its focus, not the tabs. The
  // last plan/task on stage stays mounted (hidden) while the chat is up —
  // as the Details tab keeps a canvas node — so flipping back is instant,
  // and the Details tab brings it back.
  const stage = controlPanel ?? null;
  const stageFocus = stage?.focus ?? null;
  const focusedItem = stage?.focusedItem ?? null;
  const currentDetail: StageDetail | null =
    stageFocus && stageFocus.kind !== "chat"
      ? {
          focus: stageFocus,
          workspace:
            focusedItem?.workspaceId && focusedItem.workspaceSlug
              ? { id: focusedItem.workspaceId, slug: focusedItem.workspaceSlug }
              : null,
        }
      : null;
  const [lastDetail, setLastDetail] = useState<StageDetail | null>(null);
  useEffect(() => {
    if (!stageFocus) setLastDetail(null);
    else if (currentDetail) setLastDetail((prev) => (prev?.focus === currentDetail.focus ? prev : currentDetail));
    // `currentDetail` is derived from these two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFocus, focusedItem]);
  const detail = currentDetail ?? lastDetail;
  const detailPlanId = detail?.focus.kind === "plan" ? detail.focus.id : null;
  const detailTaskNode = detail ? taskNodeFor(detail.focus) : null;
  const backToPlanId = detail?.focus.kind === "task" ? (detail.focus.planId ?? null) : null;
  const activeTab: Tab = stage ? (stageFocus?.kind === "chat" ? "chat" : "details") : tab;

  const handleRunClick = async (run: InboxRun) => {
    setInboxOpen(false);
    await openRun(run);
    setTab("chat");
  };

  /**
   * Local wrapper around `onCreateConnectionForEdge`: switch to the
   * Chat tab in the same call so the user immediately sees the
   * prefilled draft. Centralizing the tab switch here keeps the
   * parent's handler free of UI concerns (it only writes the draft
   * to the store).
   */
  const handleCreateConnectionForEdge = () => {
    onCreateConnectionForEdge();
    setTab("chat");
  };

  return (
    <div className={cn("h-full w-full flex flex-col bg-background", !stage && "border-l")}>
      {/* One bar for both views: tabs on the left, the chat's actions and
          the view toggle on the right, the same height as the control
          panel's list header across the divider — so switching views only
          swaps what sits beside the tabs and nothing jumps. */}
      <div className="flex h-11 shrink-0 items-stretch border-b text-sm">
        <div className="flex items-stretch pl-1">
          <TabButton
            label="Chat"
            isActive={activeTab === "chat"}
            onClick={() => (stage ? stage.onFocusChange({ kind: "chat" }) : setTab("chat"))}
          />
          {!stage && count > 0 && (
            <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={!chatReady}
                  className={cn(
                    "flex items-center px-1.5 py-2.5 border-b-2 -mb-[1px] border-transparent",
                    "transition-colors",
                    chatReady ? "cursor-pointer hover:text-foreground" : "opacity-50 cursor-not-allowed",
                  )}
                  aria-label={`${count} unseen automation run${count !== 1 ? "s" : ""}`}
                >
                  <Badge variant="secondary" className="ml-0">
                    {count}
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-72 p-0 overflow-hidden">
                <div className="px-3 py-2 border-b">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Unseen automation runs
                  </p>
                </div>
                <ul className="max-h-60 overflow-y-auto divide-y">
                  {runs.map((run) => (
                    <li key={run.automationId}>
                      <button
                        className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors"
                        onClick={() => handleRunClick(run)}
                      >
                        <p className="text-sm font-medium truncate">{run.automationName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(run.lastRunAt)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <TabButton
            label="Details"
            isActive={activeTab === "details"}
            onClick={() => {
              if (!stage) setTab("details");
              else if (detail) stage.onFocusChange(detail.focus);
            }}
            disabled={stage ? !detail : !selectedNode && selectedNodes.length < 2}
          />
          {!stage && (
            <TabButton
              label="Connections"
              isActive={activeTab === "connections"}
              onClick={() => setTab("connections")}
              trailing={
                <Badge variant="secondary" className="ml-1">
                  {connections.length}
                </Badge>
              }
            />
          )}
        </div>
        <div className="ml-auto flex items-center gap-1 pr-2">
          {/* Kept mounted: its settings popover and activity hook fetch on mount. */}
          <div className={cn("flex items-center", activeTab !== "chat" && "hidden")}>
            <SidebarChatActions githubLogin={githubLogin} hideHistory={!!stage} />
          </div>
          <ActionTip label={stage ? "Canvas" : "Control panel"}>
            <button
              type="button"
              onClick={stage ? stage.onExit : onOpenControlPanel}
              aria-label={stage ? "Canvas" : "Control panel"}
              className="p-1.5 rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {stage ? <Network className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
            </button>
          </ActionTip>
        </div>
      </div>
      {stage && (
        <ControlPanelBriefing
          githubLogin={githubLogin}
          onOpen={(item) => stage.onFocusChange(focusForAttentionItem(item))}
          className="mx-3 mt-3 shrink-0"
        />
      )}

      <div className="flex-1 min-h-0 relative">
        {/* Chat tab — always mounted, hidden when inactive. */}
        <TabBody hidden={activeTab !== "chat"}>
          {chatReady ? <SidebarChat githubLogin={githubLogin} /> : <ChatLoadingState />}
        </TabBody>

        {/* Details tab — also kept mounted so node-detail fetches
            don't restart when the user flips back. On the control panel
            it is what is on stage: a plan is the real plan page; a task
            renders as on the canvas, with a way back up to its plan. */}
        <TabBody hidden={activeTab !== "details"}>
          {stage && detailPlanId ? (
            <PlanStage
              featureId={detailPlanId}
              workspace={detail?.workspace ?? null}
              onBack={() => stage.onFocusChange({ kind: "chat" })}
            />
          ) : stage && detailTaskNode ? (
            <div className="flex h-full flex-col">
              {backToPlanId && (
                <button
                  type="button"
                  onClick={() => stage.onFocusChange({ kind: "plan", id: backToPlanId })}
                  className="flex shrink-0 items-center gap-1 border-b px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back to plan
                </button>
              )}
              <div className="min-h-0 flex-1">
                <NodeDetail
                  key={detailTaskNode.id}
                  node={detailTaskNode}
                  githubLogin={githubLogin}
                  onSwitchToChat={() => stage.onFocusChange({ kind: "chat" })}
                />
              </div>
            </div>
          ) : selectedNode ? (
            <NodeDetail node={selectedNode} githubLogin={githubLogin} onSwitchToChat={() => setTab("chat")} />
          ) : selectedNodes.length >= 2 ? (
            <MultiNodeDetail
              nodes={selectedNodes}
              internalEdges={selectedNodesInternalEdges}
              githubLogin={githubLogin}
            />
          ) : (
            <EmptyDetailsHint />
          )}
        </TabBody>

        {/* Connections tab — kept mounted to preserve its Pusher
            subscription and avoid re-fetching the connection list on
            every tab flip. When a connection is open, swap the list
            for the inline viewer. The list itself stays mounted
            behind the viewer (also via `hidden`) so flipping back is
            instant.

            The viewer's Unlink affordance is only meaningful when
            the open connection was opened *because of* an edge
            click. We pass `onUnlink` only in that case (active
            connection id matches the edge's customData.connectionId)
            so list-driven opens render Back-only. */}
        <TabBody hidden={activeTab !== "connections"}>
          <div className="absolute inset-0">
            <div hidden={!!activeConnection} className={activeConnection ? "" : "absolute inset-0"}>
              <ConnectionsListBody
                githubLogin={githubLogin}
                connections={connections}
                activeConnectionId={activeConnection?.id ?? null}
                onConnectionClick={onConnectionClick}
                onConnectionCreated={onConnectionCreated}
                onConnectionDeleted={onConnectionDeleted}
                isLoading={isLoading}
                selectedEdge={selectedEdge}
                onLinkConnectionToEdge={onLinkConnectionToEdge}
                onCreateConnectionForEdge={handleCreateConnectionForEdge}
                linkedConnectionIds={linkedConnectionIds}
              />
            </div>
            {activeConnection && (
              <div className="absolute inset-0">
                <ConnectionViewer
                  connection={activeConnection}
                  onBack={onConnectionClose}
                  onUnlink={
                    selectedEdge && edgeLinksToConnection(selectedEdge.edge, activeConnection.id)
                      ? onUnlinkConnectionFromEdge
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        </TabBody>
      </div>
    </div>
  );
}

/**
 * Read the connectionId off an edge's customData. The library type
 * doesn't include `customData` on edges, but JS preserves extra
 * fields verbatim through the splitter. Centralized here (and
 * mirrored in `OrgCanvasView`) so the access pattern is consistent.
 */
function edgeLinksToConnection(edge: CanvasEdge, connectionId: string): boolean {
  const cd = (edge as { customData?: { connectionId?: unknown } }).customData;
  return cd?.connectionId === connectionId;
}

/**
 * A tab body that's always mounted but visually hidden when
 * `hidden`. Uses `hidden` (the HTML attribute, which `display: none`s
 * the element) so off-screen tabs cost zero layout but keep their
 * React state. Cheaper and less surprising than `display: none`
 * via Tailwind classes — the `hidden` attribute also short-circuits
 * the accessibility tree.
 */
function TabBody({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
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
        "px-4 py-2.5 font-medium transition-colors flex items-center justify-center gap-1.5",
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
        Workspaces, initiatives, milestones, and notes all show their summary here.
      </p>
    </div>
  );
}
