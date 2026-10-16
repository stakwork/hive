"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { ArtifactPanel } from "./artifacts/ArtifactPanel";
import { ArtifactPanelSideContext, useArtifactPanelOpen } from "./artifacts/useArtifactPanel";
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

  // Fold the artifact pane away / back out before paint (collapse remembers
  // its size, expand restores it).
  useLayoutEffect(() => {
    const panel = artifactPanelRef.current;
    if (!panel) return;
    if (!artifactOpen && !panel.isCollapsed()) panel.collapse();
    else if (artifactOpen && panel.isCollapsed()) panel.expand();
  }, [artifactOpen]);

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
    <ArtifactPanelSideContext.Provider value="right">
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
        >
          <ControlPanelList {...chatList} onHide={() => listPanelRef.current?.collapse()} />
        </ResizablePanel>
        <ResizableHandle withHandle className={cn(!listOpen && "hidden")} />
        <ResizablePanel id="org-chats-chat" order={2} minSize={30}>
          {renderChat(listOpen ? undefined : () => listPanelRef.current?.expand())}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className={cn(!artifactOpen && "hidden")}
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
            if (artifactDraggingRef.current && artifactOpenRef.current) useCanvasChatStore.getState().closeArtifactPanel();
          }}
        >
          {artifactOpen && <ArtifactPanel />}
        </ResizablePanel>
      </ResizablePanelGroup>
    </ArtifactPanelSideContext.Provider>
  );
}
