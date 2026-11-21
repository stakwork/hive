"use client";

import React from "react";
import { Share2 } from "lucide-react";
import { useCanvasChatStore } from "../_state/canvasChatStore";

/**
 * The graph node Jamie is told the user is looking at, shown above the
 * composer: what "this" means in the next message. It follows the graph's
 * selection; closing the node's details drops it.
 */
export function GraphFocusChip() {
  const focus = useCanvasChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.context.graphFocus : null,
  );
  if (!focus) return null;
  return (
    <div className="flex px-1" data-testid="graph-focus-chip">
      <span
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
        title="Jamie knows you're looking at this node"
      >
        <Share2 className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{focus.name}</span>
        <span className="shrink-0 text-muted-foreground">{focus.type}</span>
      </span>
    </div>
  );
}
