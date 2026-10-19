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
 * beside it — each divider draggable, the widths remembered. The list hides
 * by collapsing; `renderChat` is handed the way to show it again. The
 * artifact pane is always in the layout and folds away (collapses) when no
 * artifact is open, so the panel set never changes and the list and the
 * artifact keep their dragged widths; opening only takes space from the chat.
 * Both ease open and shut, as the canvas view's panels do.
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
  const artifactOpen = useArtifactPanelOpen();
  const artifactPanelRef = useRef<ImperativePanelHandle>(null);
  const artifactOpenRef = useRef(artifactOpen);
  artifactOpenRef.current = artifactOpen;
  const artifactDraggingRef = useRef(false);
  /** The artifact stays up while its pane eases shut, then unmounts — nothing hidden keeps playing or polling. */
  const [artifactMounted, setArtifactMounted] = useState(artifactOpen);
  /** Off until the first layout has settled, so the restored widths don't animate in. */
  const [animate, setAnimate] = useState(false);
  const transition = animate ? RESIZABLE_PANEL_TRANSITION : undefined;

  // Fold the artifact pane away / back out before paint (collapse remembers
  // its size, expand restores it).
  useLayoutEffect(() => {
    const panel = artifactPanelRef.current;
    if (artifactOpen) setArtifactMounted(true);
    if (!panel) return;
    if (!artifactOpen && !panel.isCollapsed()) panel.collapse();
    else if (artifactOpen && panel.isCollapsed()) panel.expand();
    // Already shut (dragged there, or never open): nothing to ease out.
    else if (!artifactOpen) setArtifactMounted(false);
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
        onDragging={(d) => {
          artifactDraggingRef.current = d;
        }}
      />
      <ResizablePanel
        ref={artifactPanelRef}
        id="org-chats-artifact"
        order={3}
        defaultSize={40}
        minSize={25}
        collapsible
        collapsedSize={0}
        onCollapse={() => {
          // Only a user drag of the divider closes the artifact. The group
          // also fires onCollapse when it loads a saved layout with this
          // panel at 0 (e.g. mounting with an artifact already open).
          if (artifactDraggingRef.current && artifactOpenRef.current)
            useCanvasChatStore.getState().closeArtifactPanel();
        }}
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
