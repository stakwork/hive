"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Eye, Loader2, Pause, PenLine, Play, SkipBack, SkipForward, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { buildRunGraphTree, callLabel, replayFrame, type RunGraphTreeNode } from "@/lib/strut-run-graph/replay";
import type { RunGraphAccess, RunGraphCall, RunGraphNode, RunGraphTrace } from "@/lib/strut-run-graph/types";
import { isProvenanceType, runGraphColorMap } from "./colors";

/** Refresh cadence while the run is still going. */
const LIVE_POLL_MS = 10_000;
/** One call per tick when playing. */
const PLAY_INTERVAL_MS = 800;

const ACCESS_LABEL: Record<RunGraphAccess, string> = { read: "Reads", write: "Writes" };

function AccessIcon({ access, className }: { access: RunGraphAccess; className?: string }) {
  const Icon = access === "write" ? PenLine : Eye;
  return <Icon className={className} aria-label={access} />;
}

/** The one thing a call asked for, for its row in the tree. */
function querySummary(call: RunGraphCall): string {
  const { query } = call;
  const value = query.q ?? query.query ?? query.name ?? query.ref_id ?? query.source_ref_id ?? query.ref_ids;
  if (value === undefined) return "";
  return Array.isArray(value) ? `${value.length} refs` : String(value);
}

/** `a` → `b` → calls reads as one row, `a / b`, when `a` holds nothing else. */
function compress(node: RunGraphTreeNode): { label: string; node: RunGraphTreeNode } {
  let label = node.label;
  let current = node;
  while (current.callIndex === null && current.children.length === 1 && current.children[0].callIndex === null) {
    current = current.children[0];
    label = `${label} / ${current.label}`;
  }
  return { label, node: current };
}

function TreeBranch({
  node,
  depth,
  calls,
  step,
  expanded,
  onToggle,
  onPick,
}: {
  node: RunGraphTreeNode;
  depth: number;
  calls: RunGraphCall[];
  step: number | null;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onPick: (index: number) => void;
}) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.callIndex !== null) {
    const call = calls[node.callIndex];
    const current = step === node.callIndex;
    const past = step === null || node.callIndex < step;
    return (
      <button
        type="button"
        onClick={() => onPick(node.callIndex as number)}
        style={indent}
        data-testid="run-graph-call"
        data-current={current}
        className={`flex w-full items-center gap-2 py-1 pr-2 text-left text-xs transition-colors hover:bg-muted/60 ${
          current ? "bg-muted font-medium" : past ? "" : "text-muted-foreground/60"
        }`}
      >
        <AccessIcon access={call.access} className="h-3 w-3 shrink-0" />
        <span className="shrink-0 font-mono">{callLabel(node.label)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{querySummary(call)}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{call.nodes.length}</span>
      </button>
    );
  }

  const { label, node: branch } = compress(node);
  const open = expanded.has(branch.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(branch.path)}
        style={indent}
        aria-expanded={open}
        data-testid="run-graph-branch"
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs font-medium transition-colors hover:bg-muted/60"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{branch.callCount}</span>
      </button>
      {open &&
        branch.children.map((child) => (
          <TreeBranch
            key={child.path}
            node={child}
            depth={depth + 1}
            calls={calls}
            step={step}
            expanded={expanded}
            onToggle={onToggle}
            onPick={onPick}
          />
        ))}
    </div>
  );
}

function NodeDetail({
  node,
  color,
  calls,
  onPick,
  onClose,
}: {
  node: RunGraphNode;
  color: string;
  calls: RunGraphCall[];
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const touchedBy = useMemo(
    () => calls.flatMap((call, index) => (call.nodes.some((n) => n.ref_id === node.ref_id) ? [{ call, index }] : [])),
    [calls, node.ref_id],
  );
  return (
    <div
      className="absolute left-3 top-3 z-10 flex max-h-[85%] w-72 flex-col gap-2 overflow-y-auto rounded-lg border bg-card p-3 text-xs shadow-md"
      data-testid="run-graph-node-detail"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{node.name}</p>
          <p className="text-muted-foreground">{node.node_type}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {node.namespace && (
        <p className="text-muted-foreground">
          Namespace <span className="font-mono text-foreground">{node.namespace}</span>
        </p>
      )}
      <p className="break-all font-mono text-muted-foreground">{node.ref_id}</p>
      {!node.found && <p className="text-muted-foreground">The graph no longer holds this node.</p>}
      {node.found && workspace?.slug && (
        <Link
          href={`/w/${workspace.slug}/context/graph?ref_id=${encodeURIComponent(node.ref_id)}`}
          target="_blank"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Open in Graph Explorer
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
      <div>
        <p className="mb-1 font-medium">Touched by {touchedBy.length === 1 ? "1 call" : `${touchedBy.length} calls`}</p>
        <ul className="space-y-0.5">
          {touchedBy.map(({ call, index }) => (
            <li key={call.path}>
              <button
                type="button"
                onClick={() => onPick(index)}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/60"
              >
                <AccessIcon access={call.access} className="h-3 w-3 shrink-0" />
                <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{callLabel(call.path.split("/").pop() ?? "")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CurrentCall({ call, index, total }: { call: RunGraphCall; index: number; total: number }) {
  const query = Object.entries(call.query);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="run-graph-current-call">
      <span className="tabular-nums text-muted-foreground">
        Call {index + 1} of {total}
      </span>
      <Badge variant={call.access === "write" ? "default" : "secondary"}>{call.access}</Badge>
      <span className="font-mono">{call.tool}</span>
      <span className="text-muted-foreground">by the {call.by}</span>
      {query.map(([key, value]) => (
        <span key={key} className="max-w-xs truncate text-muted-foreground">
          {key} <span className="font-mono text-foreground">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The graph trace of a strut run: every call that touched the knowledge
 * graph as a tree under the run, the touched nodes as a 2D graph, and a
 * replay that steps through the calls in the order the run made them.
 *
 * Generic over workflows: `endpoint` answers a `RunGraphTrace`.
 */
export function StrutRunGraph({ endpoint, live = false }: { endpoint: string; live?: boolean }) {
  const [trace, setTrace] = useState<RunGraphTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<RunGraphAccess, boolean>>({ read: true, write: true });
  const [typeOverrides, setTypeOverrides] = useState<Record<string, boolean>>({});
  /** Index of the current call; null = the whole run. */
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as RunGraphTrace & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the graph trace");
      setTrace(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the graph trace");
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const calls = useMemo(() => (trace?.calls ?? []).filter((call) => shown[call.access]), [trace?.calls, shown]);
  const current = step !== null && step < calls.length ? step : null;

  const tree = useMemo(() => buildRunGraphTree(calls), [calls]);
  const nodeById = useMemo(() => new Map((trace?.nodes ?? []).map((n) => [n.ref_id, n])), [trace?.nodes]);

  // Everything the shown calls touched, whatever its type — the legend counts these.
  const touched = useMemo(() => {
    const ids = new Set(calls.flatMap((call) => call.nodes.map((n) => n.ref_id)));
    return (trace?.nodes ?? []).filter((n) => ids.has(n.ref_id));
  }, [calls, trace?.nodes]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of touched) counts.set(node.node_type, (counts.get(node.node_type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [touched]);

  const colorMap = useMemo(() => runGraphColorMap(typeCounts.map(([type]) => type)), [typeCounts]);
  const typeVisible = useCallback(
    (type: string) => typeOverrides[type] ?? !isProvenanceType(type),
    [typeOverrides],
  );

  const graphNodes = useMemo<GraphNode[]>(
    () =>
      touched
        .filter((n) => typeVisible(n.node_type))
        .map((n) => ({ id: n.ref_id, name: n.name, type: n.node_type })),
    [touched, typeVisible],
  );
  const graphEdges = useMemo<GraphEdge[]>(() => {
    const ids = new Set(graphNodes.map((n) => n.id));
    return (trace?.edges ?? [])
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.edge_type }));
  }, [graphNodes, trace?.edges]);

  const frame = useMemo(() => replayFrame(calls, current ?? calls.length), [calls, current]);
  const activeIds = useMemo(() => {
    const ids = new Set(frame.active);
    if (selectedId) ids.add(selectedId);
    return ids;
  }, [frame.active, selectedId]);

  // The current call's branch is always open.
  useEffect(() => {
    if (current === null) return;
    const segments = calls[current].path.split("/");
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < segments.length; i++) next.add(segments.slice(0, i).join("/"));
      return next.size === prev.size ? prev : next;
    });
  }, [current, calls]);

  useEffect(() => {
    if (tree) setExpanded((prev) => (prev.has(tree.path) ? prev : new Set(prev).add(tree.path)));
  }, [tree]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setStep((s) => (s === null || s + 1 >= calls.length ? null : s + 1));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, calls.length]);

  // Playing starts on a call, so the whole run while playing is the end of the replay.
  useEffect(() => {
    if (playing && current === null) setPlaying(false);
  }, [playing, current]);

  const pick = useCallback((index: number) => {
    setPlaying(false);
    setStep(index);
  }, []);
  const showAll = useCallback(() => {
    setPlaying(false);
    setStep(null);
  }, []);
  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (current === null) setStep(0);
    setPlaying(true);
  }, [playing, current]);
  const toggleBranch = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);
  const selectNode = useCallback((node: GraphNode) => setSelectedId(node.id), []);

  // GraphVisualization wants pixels.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      setSize((prev) =>
        prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [trace]);

  if (error && !trace) {
    return (
      <p className="p-4 text-sm text-destructive" data-testid="run-graph-error">
        {error}
      </p>
    );
  }
  if (!trace) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid="run-graph-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the run…
      </p>
    );
  }
  if (trace.calls.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground" data-testid="run-graph-empty">
        {live ? "The run has not touched the graph yet." : "This run did not touch the graph."}
      </p>
    );
  }

  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const last = calls.length - 1;

  return (
    <div className="flex flex-col" data-testid="run-graph">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Previous call"
              disabled={calls.length === 0 || current === 0}
              onClick={() => pick(current === null ? last : current - 1)}
            >
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label={playing ? "Pause" : "Play"}
              disabled={calls.length === 0}
              onClick={togglePlay}
              data-testid="run-graph-play"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Next call"
              disabled={current === null}
              onClick={() => (current === null || current >= last ? showAll() : pick(current + 1))}
            >
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Slider
            className="min-w-40 flex-1"
            min={0}
            max={calls.length}
            step={1}
            value={[current ?? calls.length]}
            onValueChange={([value]) => (value >= calls.length ? showAll() : pick(value))}
            aria-label="Replay position"
            data-testid="run-graph-slider"
          />
          <div className="flex items-center gap-1">
            {(Object.keys(ACCESS_LABEL) as RunGraphAccess[]).map((access) => (
              <Button
                key={access}
                variant={shown[access] ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5 text-xs"
                aria-pressed={shown[access]}
                onClick={() => {
                  showAll();
                  setShown((prev) => ({ ...prev, [access]: !prev[access] }));
                }}
              >
                <AccessIcon access={access} className="h-3 w-3" />
                {ACCESS_LABEL[access]}
              </Button>
            ))}
          </div>
        </div>
        {current !== null ? (
          <CurrentCall call={calls[current]} index={current} total={calls.length} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {calls.length} calls touched {touched.length} nodes
            {live ? " so far" : ""}. Step through them, or pick one in the tree.
            {trace.truncated ? " The run touched more than are shown." : ""}
          </p>
        )}
      </div>

      <div className="grid h-[640px] grid-cols-[minmax(240px,340px)_1fr]">
        <div className="overflow-y-auto border-r py-1" data-testid="run-graph-tree">
          {tree && (
            <TreeBranch
              node={tree}
              depth={0}
              calls={calls}
              step={current}
              expanded={expanded}
              onToggle={toggleBranch}
              onPick={pick}
            />
          )}
        </div>
        <div ref={canvasRef} className="relative min-w-0 overflow-hidden" data-testid="run-graph-canvas">
          {size && graphNodes.length > 0 && (
            <GraphVisualization
              nodes={graphNodes}
              edges={graphEdges}
              width={size.width}
              height={size.height}
              colorMap={colorMap}
              onNodeClick={selectNode}
              hiddenIds={frame.hidden}
              activeIds={activeIds}
              fit
            />
          )}
          {selected && (
            <NodeDetail
              node={selected}
              color={colorMap[selected.node_type] ?? "#6b7280"}
              calls={calls}
              onPick={pick}
              onClose={() => setSelectedId(null)}
            />
          )}
          <ul
            className="absolute bottom-3 right-3 flex max-h-[60%] w-52 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-card p-2 text-xs"
            data-testid="run-graph-legend"
          >
            {typeCounts.map(([type, count]) => {
              const visible = typeVisible(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    aria-pressed={visible}
                    onClick={() => setTypeOverrides((prev) => ({ ...prev, [type]: !visible }))}
                    className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60 ${
                      visible ? "" : "text-muted-foreground line-through"
                    }`}
                  >
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: visible ? colorMap[type] : "transparent", border: `1px solid ${colorMap[type]}` }}
                    />
                    <span className="min-w-0 flex-1 truncate">{type}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
