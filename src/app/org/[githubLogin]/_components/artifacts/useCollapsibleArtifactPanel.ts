"use client";

import { useEffect, useLayoutEffect, useRef, useState, type TransitionEvent } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { RESIZABLE_PANEL_TRANSITION } from "@/components/ui/resizable";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { useArtifactPanelOpen } from "./useArtifactPanel";

/**
 * The resizable artifact pane shared by the chats view and the brainstorm canvas. The pane is always in its
 * `ResizablePanelGroup` and folds away (collapses) when no artifact is open, so the panel set never changes and
 * the dragged width is remembered; it eases open and shut. The artifact stays mounted while the pane eases
 * shut, then unmounts — nothing hidden keeps playing or polling.
 *
 * Spread `panelProps` on the `ResizablePanel` (with its own id/order/sizes) and `handleProps` on the
 * `ResizableHandle` beside it; hide the handle with `mounted`. Render the `ArtifactPanel` only while `mounted`.
 */
export function useCollapsibleArtifactPanel() {
  const artifactOpen = useArtifactPanelOpen();
  const panelRef = useRef<ImperativePanelHandle>(null);
  const openRef = useRef(artifactOpen);
  openRef.current = artifactOpen;
  const draggingRef = useRef(false);
  const [mounted, setMounted] = useState(artifactOpen);
  /** Off until the first layout has settled, so the restored widths don't animate in. */
  const [animate, setAnimate] = useState(false);
  const transition = animate ? RESIZABLE_PANEL_TRANSITION : undefined;

  // Fold the pane away / back out before paint (collapse remembers its size, expand restores it).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (artifactOpen) setMounted(true);
    if (!panel) return;
    if (!artifactOpen && !panel.isCollapsed()) panel.collapse();
    else if (artifactOpen && panel.isCollapsed()) panel.expand();
    // Already shut (dragged there, or never open): nothing to ease out.
    else if (!artifactOpen) setMounted(false);
  }, [artifactOpen]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const unmountIfShut = (e: TransitionEvent) => {
    if (e.target === e.currentTarget && !artifactOpen) setMounted(false);
  };

  return {
    artifactOpen,
    mounted,
    /** The class that eases a panel's resize; give it to the sibling panels too. */
    transition,
    panelRef,
    handleProps: {
      onDragging: (d: boolean) => {
        draggingRef.current = d;
      },
    },
    panelProps: {
      ref: panelRef,
      collapsible: true as const,
      collapsedSize: 0,
      onCollapse: () => {
        // Only a user drag of the divider closes the artifact. The group also fires onCollapse when it
        // loads a saved layout with this panel at 0 (e.g. mounting with an artifact already open).
        if (draggingRef.current && openRef.current) useCanvasChatStore.getState().closeArtifactPanel();
      },
      className: transition,
      onTransitionEnd: unmountIfShut,
      // A drag that interrupts the ease ends it without a transitionend.
      onTransitionCancel: unmountIfShut,
    },
  };
}
