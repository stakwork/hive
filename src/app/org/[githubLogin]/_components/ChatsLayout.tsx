"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  RESIZABLE_PANEL_TRANSITION,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";
import { useArtifactPanelOpen } from "./artifacts/useArtifactPanel";
import { ControlPanelList } from "./control-panel/ControlPanelList";
import { useControlPanel } from "./control-panel/useControlPanel";
import { canvasViewHref, orgPageView } from "./useOrgView";

/**
 * The org page's chats view: the chat list, the chat, and the artifact pane
 * beside it while one is open — each divider draggable, the widths
 * remembered. The list hides by collapsing; `renderChat` is handed the way
 * to show it again. The artifact pane stays mounted and collapses while
 * nothing is open, so it eases open and shut as the list does.
 *
 * There is no canvas on this view, so anything that asks for one — a
 * canvas-only param written into the URL (`?r=`, `?canvas=`), a canvas
 * deep link from the chat — goes to the canvas view, the open chat with it.
 */
export function ChatsLayout({
  githubLogin,
  renderChat,
}: {
  githubLogin: string;
  renderChat: (onShowList: (() => void) | undefined) => ReactNode;
}) {
  const listPanelRef = useRef<ImperativePanelHandle>(null);
  const [listOpen, setListOpen] = useState(true);
  const chatList = useControlPanel(githubLogin);
  const artifactPanelRef = useRef<ImperativePanelHandle>(null);
  const artifactOpen = useArtifactPanelOpen();
  /** The artifact stays up while its pane eases shut, then unmounts — nothing hidden keeps playing or polling. */
  const [artifactMounted, setArtifactMounted] = useState(artifactOpen);
  /** Off until the first layout has settled, so the restored widths don't animate in. */
  const [animate, setAnimate] = useState(false);
  const transition = animate ? RESIZABLE_PANEL_TRANSITION : undefined;

  useLayoutEffect(() => {
    const panel = artifactPanelRef.current;
    if (artifactOpen) {
      setArtifactMounted(true);
      panel?.expand();
    } else if (!panel || panel.isCollapsed()) {
      setArtifactMounted(false);
    } else {
      panel.collapse();
    }
  }, [artifactOpen]);
  const unmountIfShut = (e: React.TransitionEvent) => {
    if (e.target === e.currentTarget && !artifactOpen) setArtifactMounted(false);
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pendingDeeplink = useCanvasChatStore((s) => s.pendingDeeplink);
  useEffect(() => {
    if (pendingDeeplink) {
      window.location.assign(canvasViewHref(pathname, searchParams, { canvas: pendingDeeplink.canvasRef }));
    } else if (orgPageView(searchParams) === "canvas") {
      window.location.assign(canvasViewHref(pathname, searchParams, {}));
    }
  }, [pendingDeeplink, pathname, searchParams]);

  return (
    <ResizablePanelGroup id="org-chats-group" direction="horizontal" autoSaveId="org-chats" className="h-full w-full">
      <ResizablePanel
        ref={listPanelRef}
        id="org-chats-list"
        order={1}
        defaultSize={20}
        minSize={12}
        maxSize={40}
        collapsible
        collapsedSize={0}
        onCollapse={() => setListOpen(false)}
        onExpand={() => setListOpen(true)}
        className={transition}
      >
        <ControlPanelList {...chatList} onHide={() => listPanelRef.current?.collapse()} />
      </ResizablePanel>
      <ResizableHandle withHandle className={cn(!listOpen && "hidden")} />
      <ResizablePanel id="org-chats-chat" order={2} minSize={30} className={transition}>
        {renderChat(listOpen ? undefined : () => listPanelRef.current?.expand())}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        className={cn(!artifactMounted && "hidden")}
        // Dragged shut: the artifact is closed, as its own close would.
        onDragging={(isDragging) => {
          if (!isDragging && artifactPanelRef.current?.isCollapsed())
            useCanvasChatStore.getState().closeArtifactPanel();
        }}
      />
      {/* Starts at its default width and, with nothing open, collapses from there — so the first open restores that width, not `minSize`. */}
      <ResizablePanel
        ref={artifactPanelRef}
        id="org-chats-artifact"
        order={3}
        defaultSize={40}
        minSize={25}
        collapsible
        collapsedSize={0}
        className={transition}
        onTransitionEnd={unmountIfShut}
        // A drag that interrupts the ease ends it without a transitionend.
        onTransitionCancel={unmountIfShut}
      >
        {artifactMounted && <ArtifactPanel />}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
