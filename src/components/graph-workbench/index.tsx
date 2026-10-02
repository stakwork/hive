"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Loader2 } from "lucide-react";
import { GraphCanvas } from "./GraphCanvas";
import { NodeDetails } from "./NodeDetails";
import { WorkbenchProvider, useWorkbench, type WorkbenchOptions } from "./store";
import { Toolbar } from "./Toolbar";
import { TreeCanvas } from "./TreeCanvas";

const SLIDE = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

/** "3 new nodes", or nothing for none. */
const count = (n: number, one: string, many: string) => n > 0 && `${n} ${n === 1 ? one : many}`;

function Body({
  leading,
  trailing,
  notice,
}: {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  notice?: string;
}) {
  const { graph, lens, pending, loading, error, truncated, selectedId, select, canvasMode } = useWorkbench();
  const proposed = [
    count(pending.created, "new node", "new nodes"),
    count(pending.newEdges.size + pending.links.length, "new link", "new links"),
    count(pending.edited, "edit", "edits"),
  ].filter(Boolean);

  // The toolbar stays through loading and errors, so the source can always be changed.
  const status = loading ? (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Reading the graph…
    </div>
  ) : error ? (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-sm">
      <p>Couldn&apos;t read this graph.</p>
      <p className="max-w-lg text-center text-xs text-muted-foreground">{error}</p>
    </div>
  ) : !graph || Object.keys(graph.nodes).length === 0 ? (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No {lens.type} nodes in this graph yet.
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="graph-workbench">
      <Toolbar leading={leading} trailing={trailing} />
      {proposed.length > 0 && (
        <p
          className="border-b border-dashed border-emerald-500 px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-400"
          data-testid="graph-workbench-proposal"
        >
          Previewing a proposal: {proposed.join(" · ")}. Dashed is what would change — approve or reject it in the chat.
        </p>
      )}
      {notice && (
        <p className="border-b px-4 py-1.5 text-xs text-muted-foreground" data-testid="graph-workbench-notice">
          {notice}
        </p>
      )}
      {truncated && (
        <p className="flex items-center gap-1.5 border-b px-4 py-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" />
          This graph is bigger than one read returns, so some {lens.type} nodes or links may be missing.
        </p>
      )}
      {status ?? (
        <div className="flex min-h-0 flex-1">
          {/* A tapped node's details slide in from the left, beside the canvas. */}
          <AnimatePresence initial={false}>
            {selectedId && (
              <motion.aside
                key="details"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
                transition={SLIDE}
                className="w-[400px] max-w-[45%] shrink-0 overflow-y-auto border-r p-4"
              >
                {/* Keyed by node: a new node starts with its own state (no open group, no half-made edit). */}
                <NodeDetails key={selectedId} id={selectedId} onClose={() => select(null)} />
              </motion.aside>
            )}
          </AnimatePresence>
          <main className="min-w-0 flex-1">
            {canvasMode === "graph" ? <GraphCanvas /> : graph && <TreeCanvas graph={graph} />}
          </main>
        </div>
      )}
    </div>
  );
}

/**
 * Read, audit and walk a workspace's knowledge graph: concept trees left to
 * right, any node's details, and every edge type in Graph mode.
 *
 * `leading` is the first crumb of the toolbar's path (the org page's
 * workspace `Picker`); `trailing` sits at the toolbar's end ("Ask Jamie").
 * Remount with a new `key` to switch workspaces cleanly.
 */
export function GraphWorkbench({
  workspaceSlug,
  notice,
  leading,
  trailing,
  ...options
}: WorkbenchOptions & {
  workspaceSlug: string;
  /** A line under the toolbar, e.g. what became of the proposal being shown. */
  notice?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <WorkbenchProvider slug={workspaceSlug} {...options}>
      <Body leading={leading} trailing={trailing} notice={notice} />
    </WorkbenchProvider>
  );
}

export { Picker } from "./Toolbar";
export type { SelectedNode } from "./store";
