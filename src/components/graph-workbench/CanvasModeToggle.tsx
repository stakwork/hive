"use client";

import { cn } from "@/lib/utils";
import { useWorkbench } from "./store";

/** Tree: the hierarchy, left to right. Graph: every edge type, walked by clicking. */
export function CanvasModeToggle() {
  const { canvasMode, setCanvasMode } = useWorkbench();
  return (
    <div className="flex items-center rounded border p-0.5 text-xs" data-testid="graph-workbench-mode">
      {(["tree", "graph"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setCanvasMode(mode)}
          className={cn(
            "rounded-sm px-1.5 py-0.5",
            canvasMode === mode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {mode === "tree" ? "Tree" : "Graph"}
        </button>
      ))}
    </div>
  );
}
