"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GraphChange } from "./changes";
import { DEFAULT_TREE, buildGraph, rootsOf, type TreeLens, type WorkbenchGraph, type WorkbenchNode } from "./model";
import { NO_PENDING, applyChanges, findNode, type Pending } from "./pending";
import { connectionsQuery, hierarchyQuery } from "./queries";

type CanvasMode = "tree" | "graph";

interface WorkbenchState extends Pick<WorkbenchOptions, "nodeLink"> {
  slug: string;
  /** Which nodes make the trees, and the edge that runs from parent to child. */
  lens: TreeLens;
  /** A new type re-reads the graph; a new edge only rebuilds the trees. */
  setLens: (lens: Partial<TreeLens>) => void;
  /** The loaded graph, with any proposed changes laid over it. */
  graph: WorkbenchGraph | null;
  /** Roots of the graph's trees, biggest first. */
  roots: Array<{ node: WorkbenchNode; size: number }>;
  /** The proposed changes being previewed, if any. */
  pending: Pending;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** The node the details panel shows — any type, not only the tree's. */
  selectedId: string | null;
  select: (id: string | null) => void;
  /** An explicit "centre on this" (search, start picker, deep link). Plain selection only extends the canvas. */
  focus: { id: string | null; nonce: number };
  focusNode: (id: string) => void;
  /** The tree the start picker shows as current. */
  rootId: string | null;
  canvasMode: CanvasMode;
  setCanvasMode: (mode: CanvasMode) => void;
}

const Ctx = createContext<WorkbenchState | null>(null);

export function useWorkbench(): WorkbenchState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkbench must be used inside <WorkbenchProvider>");
  return ctx;
}

/** A node in the graph a host can point at: one that exists, not one a proposal would create. */
export type SelectedNode = Pick<WorkbenchNode, "id" | "name" | "type">;

export interface WorkbenchOptions {
  /** Centre on this node when the graph loads (a deep link): its ref_id, own id or name — or the first of several that exists. */
  initialFocusId?: string | readonly string[] | null;
  /** Open on this node type's trees, rather than the default tree's. */
  initialType?: string | null;
  /** A proposal's changes, drawn dashed over the graph. */
  changes?: GraphChange[];
  /** The selected node, when it exists (not one a proposal would create) — keep it stable, it's an effect dependency. */
  onSelectionChange?: (node: SelectedNode | null) => void;
  /** A shareable link to a node. The host knows where its graph lives; without one there's no share button. */
  nodeLink?: (node: Pick<SelectedNode, "id" | "type">) => string;
}

export function WorkbenchProvider({
  slug,
  initialFocusId,
  initialType,
  changes,
  onSelectionChange,
  nodeLink,
  children,
}: WorkbenchOptions & { slug: string; children: React.ReactNode }) {
  const [lens, setLensState] = useState<TreeLens>(() => ({ ...DEFAULT_TREE, type: initialType || DEFAULT_TREE.type }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const [rootId, setRootId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("tree");
  // The deep link applies to the first graph read only, not to a later change of type.
  const deepLinks = useRef([initialFocusId ?? []].flat());
  /** Where the next graph should land: a fresh read lands anew, a new edge on its biggest tree. */
  const land = useRef<"read" | "edge" | null>("read");

  const { data: hierarchy, error, isPending, isFetching } = useQuery(hierarchyQuery(slug, lens.type));

  const { graph, pending } = useMemo(
    () => (hierarchy ? applyChanges(buildGraph(hierarchy, lens), changes) : { graph: null, pending: NO_PENDING }),
    [hierarchy, lens, changes],
  );
  const roots = useMemo(() => (graph ? rootsOf(graph) : []), [graph]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      // Anything outside the loaded trees can only be shown as a graph.
      if (id && graph && !graph.nodes[id]) setCanvasMode("graph");
    },
    [graph],
  );

  const focusNode = useCallback(
    (id: string) => {
      select(id);
      setFocus((f) => ({ id, nonce: f.nonce + 1 }));
      if (graph?.nodes[id]?.root) setRootId(id);
    },
    [select, graph],
  );

  useEffect(() => {
    const kind = land.current;
    if (!graph || !kind) return;
    const [preferred, ...others] = deepLinks.current;
    const found = preferred ? findNode(graph, preferred) : null;
    // The node a deep link prefers may only be in the read still in flight (a concept an approval just made): wait for it.
    if (preferred && !found && isFetching) return;
    const linked = found ?? others.map((ref) => findNode(graph, ref)).find(Boolean) ?? null;
    land.current = null;
    const biggest = roots[0]?.node.id ?? null;
    setRootId(biggest);
    if (kind === "edge") {
      if (biggest) focusNode(biggest);
      return;
    }
    // Land on the deep-linked node (by ref_id, own id or name), else what a proposal changes, else the biggest tree.
    const start = linked ?? pending.focus ?? biggest ?? Object.keys(graph.nodes)[0] ?? null;
    deepLinks.current = [];
    setCanvasMode("tree");
    if (start) focusNode(start);
    else setSelectedId(null);
  }, [graph, roots, pending, focusNode, isFetching]);

  const setLens = useCallback(
    (next: Partial<TreeLens>) => {
      const type = next.type ?? lens.type;
      const edge = next.edge ?? graph?.lens.edge ?? lens.edge;
      if (type === lens.type && edge === (graph?.lens.edge ?? lens.edge)) return;
      land.current = type !== lens.type ? "read" : "edge";
      setLensState({ type, edge });
    },
    [lens, graph],
  );

  const inTree = selectedId ? graph?.nodes[selectedId] : undefined;
  // A node outside the trees (a neighbour, a Graph-mode click) is known from its own read: the one its details make.
  const outside = !!selectedId && !!graph && !inTree;
  const { data: read, isPending: reading } = useQuery({
    ...connectionsQuery(slug, selectedId ?? ""),
    enabled: outside,
  });
  const selectedNode: SelectedNode | null = inTree
    ? inTree.proposed
      ? null
      : inTree
    : outside && read
      ? { id: read.node.id, name: read.node.name, type: read.node.type }
      : null;
  const resolving = outside && reading;
  useEffect(() => {
    // A node outside the trees is reported once its read is in, not as nothing meanwhile.
    if (resolving) return;
    onSelectionChange?.(selectedNode && { id: selectedNode.id, name: selectedNode.name, type: selectedNode.type });
    // Report a change of node, not every rebuild of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, selectedNode?.name, selectedNode?.type, resolving, onSelectionChange]);

  const value = useMemo<WorkbenchState>(
    () => ({
      slug,
      lens: graph?.lens ?? lens,
      setLens,
      graph,
      roots,
      pending,
      loading: isPending,
      error: error?.message ?? null,
      truncated: hierarchy?.truncated ?? false,
      selectedId,
      select,
      focus,
      focusNode,
      rootId,
      canvasMode,
      setCanvasMode,
      nodeLink,
    }),
    [
      slug,
      lens,
      setLens,
      graph,
      roots,
      pending,
      isPending,
      error,
      hierarchy,
      selectedId,
      select,
      focus,
      focusNode,
      rootId,
      canvasMode,
      nodeLink,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
