"use client";

import { useEffect, useMemo, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Layers, MousePointerClick, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { NodeDetail } from "./NodeDetail";
import { MultiNodeDetail } from "./MultiNodeDetail";
import { NewChatButton, SidebarChat, SidebarChatActions } from "./SidebarChat";
import type { InternalEdge } from "../connections/OrgCanvasBackground";
import { useAutomationInbox, type InboxRun } from "../_state/useAutomationInbox";
import { formatRelativeTime } from "./CanvasHistoryPopover";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { latestArtifacts } from "../_state/canvasChatArtifacts";
import { ToolbarButton } from "./artifacts/chrome";
import { useActiveArtifacts, useArtifactPanelOpen } from "./artifacts/useArtifactPanel";
import { ActionTip } from "./ActionTip";

type Tab = "chat" | "details";

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
  selectedNodes: CanvasNode[];
  selectedNodesInternalEdges: InternalEdge[];
  /**
   * The Chats view: this panel is the page's main column — the chat alone
   * under its title, no tabs, with the artifacts pane's toggle in the bar.
   * `onShowList` is set while the chat list is hidden.
   */
  chatsView?: { onShowList?: () => void };
}

/**
 * The chat — the Chats view's main column, or the canvas's tabbed right
 * sidebar. On the canvas, two tabs:
 *
 * - **Chat** — `<SidebarChat />`. The default landing tab; the
 *   agent's home base on the canvas page.
 * - **Details** — node summary. Auto-selected when a node is clicked.
 *
 * One bar: tabs (on the Chats view, the chat's title) on the left, the
 * chat's actions (`SidebarChatActions`; the chat itself renders headerless)
 * on the right.
 *
 * **Both tabs stay mounted.** Inactive tabs are hidden via the
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
  chatsView,
}: OrgRightPanelProps) {
  // Default to Chat — the canvas's primary agent surface. Auto-flip
  // to Details when the user clicks a node. Manual tab clicks
  // override this until the next trigger. Keying on
  // `selectedNode?.id` (not the object identity) so the canvas
  // re-emitting the same object on reselect still re-fires.
  const [tab, setTab] = useState<Tab>("chat");
  const [inboxOpen, setInboxOpen] = useState(false);
  const artifactOpen = useArtifactPanelOpen();

  useEffect(() => {
    if (selectedNode) setTab("details");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);
  useEffect(() => {
    if (selectedNodes.length >= 2) setTab("details");
  }, [selectedNodes.length]);

  const { count, runs, openRun } = useAutomationInbox(githubLogin, { chatReady });

  const activeTab: Tab = chatsView ? "chat" : tab;

  // A canvas affordance (the brainstorm board's click) composed a message: show the Chat tab it lands in.
  const composing = useCanvasChatStore((s) => s.pendingInputDraft !== null || s.pendingInputAppend !== null);
  useEffect(() => {
    if (composing) setTab("chat");
  }, [composing]);

  const handleRunClick = async (run: InboxRun) => {
    setInboxOpen(false);
    await openRun(run);
    setTab("chat");
  };

  return (
    <div
      className={cn(
        "h-full w-full flex flex-col bg-background",
        // Beside the artifact panel the divider alone is the line; the border keeps its width so the chat does not shift.
        !chatsView && (artifactOpen ? "border-l border-transparent" : "border-l"),
      )}
    >
      {/* One bar, the same height as the chat list's header across the divider. It is a
          container: the actions collapse (Share → icon-only) by the bar's own width. */}
      <div className="@container flex h-11 shrink-0 items-stretch overflow-hidden border-b text-sm">
        {chatsView ? (
          <div className="flex min-w-0 items-center gap-1 pl-2">
            {chatsView.onShowList && (
              <ToolbarButton label="Show chats" onClick={chatsView.onShowList}>
                <PanelLeftOpen className="h-4 w-4" />
              </ToolbarButton>
            )}
            {/* The chat list's header has New chat; with the list hidden it moves here. */}
            {chatsView.onShowList && <NewChatButton githubLogin={githubLogin} />}
            <ChatTitle />
          </div>
        ) : (
          <div className="flex shrink-0 items-stretch pl-0 @[22rem]:pl-1">
            <TabButton label="Chat" isActive={activeTab === "chat"} onClick={() => setTab("chat")} />
            {count > 0 && (
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
              onClick={() => setTab("details")}
              disabled={!selectedNode && selectedNodes.length < 2}
            />
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0 pl-1 pr-1 @[22rem]:gap-1 @[22rem]:pr-2">
          {/* Kept mounted: its activity hook fetches on mount. */}
          <div className={cn("flex items-center", activeTab !== "chat" && "hidden")}>
            <SidebarChatActions githubLogin={githubLogin} hideHistory={!!chatsView} hideNewChat={!!chatsView} />
          </div>
          {chatsView && <ArtifactsToggle />}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* Chat tab — always mounted, hidden when inactive. */}
        <TabBody hidden={activeTab !== "chat"}>
          {chatReady ? <SidebarChat githubLogin={githubLogin} wide={!!chatsView} /> : <ChatLoadingState />}
        </TabBody>

        {/* Details tab — also kept mounted so node-detail fetches
            don't restart when the user flips back. */}
        <TabBody hidden={activeTab !== "details"}>
          {selectedNode ? (
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
      </div>
    </div>
  );
}

/** The chat's title, as the list shows it. */
function ChatTitle() {
  const title = useCanvasChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.title : null,
  );
  return <h1 className="min-w-0 truncate px-1 text-sm font-medium">{title || "New chat"}</h1>;
}

/**
 * Shows or hides the artifacts pane: open, it lists what Jamie made in
 * this chat; the count is how many artifacts there are.
 */
function ArtifactsToggle() {
  const artifacts = useActiveArtifacts();
  const count = useMemo(() => latestArtifacts(artifacts).length, [artifacts]);
  const open = useArtifactPanelOpen();
  if (count === 0) return null;
  const label = open ? "Hide artifacts" : "Show artifacts";
  return (
    <ActionTip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={open}
        onClick={() => {
          const store = useCanvasChatStore.getState();
          if (open) store.closeArtifactPanel();
          else store.openArtifactIndex();
        }}
        className="flex h-7 items-center gap-1.5 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Layers className="h-4 w-4" />
        <span className="tabular-nums">{count}</span>
        {open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </button>
    </ActionTip>
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
        // Tight below the header's 22rem container breakpoint so both tabs fit a ~190px panel.
        "px-1 py-2.5 text-xs @[22rem]:px-4 @[22rem]:text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
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
