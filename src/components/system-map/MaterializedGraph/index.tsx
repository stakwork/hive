"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Search, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphNode } from "@/components/graph/graphUtils";
import {
  buildCanvasElements,
  edgeStyleForLabel,
  groupEdgesByType,
  groupNodesByType,
  MATERIALIZED_STATUSES,
  STATUS_HEX,
  type CanvasColorMode,
  type EdgeTypeGroup,
  type MaterializedEdge,
  type MaterializedFilter,
  type MaterializedGraph as Graph,
  type MaterializedNode,
  type MaterializedStatus,
  type NodeTypeGroup,
  type StatusCounts,
} from "./model";

const GRAPH_HEIGHT = 620;

/**
 * Status is a colour job: accepted = good, rejected = critical; always icon +
 * label. No `dark:` variants — see `SystemMapReport/verdict.tsx`.
 */
const STATUS_STYLE: Record<MaterializedStatus, { label: string; icon: LucideIcon; text: string; tile: string; ring: string }> = {
  accepted: {
    label: "Accepted",
    icon: CheckCircle2,
    text: "text-emerald-600",
    tile: "bg-emerald-500/10",
    ring: "ring-emerald-500/60",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    text: "text-rose-600",
    tile: "bg-rose-500/10",
    ring: "ring-rose-500/60",
  },
};

function StatusBadge({ status }: { status: MaterializedStatus }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", style.text)} data-testid={`status-${status}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {style.label}
    </span>
  );
}

function CountChips({ counts }: { counts: StatusCounts }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      {MATERIALIZED_STATUSES.filter((s) => counts[s] > 0).map((s) => {
        const Icon = STATUS_STYLE[s].icon;
        return (
          <span key={s} className="inline-flex items-center gap-1">
            <Icon className={cn("h-3 w-3", STATUS_STYLE[s].text)} aria-hidden />
            {counts[s]}
          </span>
        );
      })}
    </span>
  );
}

function StatTile({
  label,
  count,
  status,
  active,
  onToggle,
}: {
  label: string;
  count: number;
  status: MaterializedStatus;
  active: boolean;
  onToggle: () => void;
}) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
        style.tile,
        active ? cn("ring-2", style.ring) : "hover:border-foreground/30",
      )}
      data-testid={`materialized-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", style.text)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
      <span className="text-2xl font-semibold leading-none text-foreground">{count}</span>
    </button>
  );
}

function Details({ evidence, reasons }: { evidence: string[]; reasons: string[] }) {
  if (evidence.length === 0 && reasons.length === 0) return null;
  return (
    <div className="mt-1 space-y-1 text-xs">
      {reasons.length > 0 && (
        <p className="text-rose-600">
          {reasons.map((r) => (
            <code key={r} className="mr-2">
              {r}
            </code>
          ))}
        </p>
      )}
      {evidence.map((line, i) => (
        <p key={i} className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

function NodeRow({ node, onSelect }: { node: MaterializedNode; onSelect: (n: MaterializedNode) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-muted/50" data-testid="materialized-node-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm hover:underline" title={node.id}>
          {node.name}
        </button>
        <code className="text-[11px] text-muted-foreground">{node.id}</code>
        <StatusBadge status={node.status} />
        <button type="button" onClick={() => onSelect(node)} className="ml-auto text-xs text-muted-foreground hover:underline">
          Properties
        </button>
      </div>
      {open && <Details evidence={node.evidence} reasons={node.reasons} />}
    </div>
  );
}

function NodeTypeSection({ group, onSelect }: { group: NodeTypeGroup; onSelect: (n: MaterializedNode) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border" data-testid="materialized-type-group">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={open}>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="font-mono text-sm font-medium">{group.type}</span>
        <span className="text-xs text-muted-foreground">{group.nodes.length}</span>
        <span className="ml-auto">
          <CountChips counts={group.counts} />
        </span>
      </button>
      {open && (
        <div className="border-t px-1 py-1">
          {group.nodes.map((node) => (
            <NodeRow key={node.id} node={node} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function EdgeRow({ edge }: { edge: MaterializedEdge }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-muted/50" data-testid="materialized-edge-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((o) => !o)} className="font-mono text-xs hover:underline">
          {edge.source}
          <span className="mx-1.5 text-muted-foreground">→</span>
          {edge.target}
        </button>
        <StatusBadge status={edge.status} />
      </div>
      {open && <Details evidence={edge.evidence} reasons={edge.reasons} />}
    </div>
  );
}

function EdgeTypeSection({ group }: { group: EdgeTypeGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border" data-testid="materialized-edge-group">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={open}>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="font-mono text-sm font-medium">{group.edgeType}</span>
        <span className="text-xs text-muted-foreground">{group.edges.length}</span>
        <span className="ml-auto">
          <CountChips counts={group.counts} />
        </span>
      </button>
      {open && (
        <div className="border-t px-1 py-1">
          {group.edges.map((edge, i) => (
            <EdgeRow key={`${edge.source}-${edge.edgeType}-${edge.target}-${i}`} edge={edge} />
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ node, onClose }: { node: MaterializedNode; onClose: () => void }) {
  const entries = Object.entries(node.properties).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div
      className="absolute right-3 top-3 z-10 w-80 max-w-[70%] rounded-lg border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      data-testid="materialized-detail"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={node.name}>
            {node.name}
          </p>
          <p className="font-mono text-muted-foreground">
            {node.type} · {node.id}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2">
        <StatusBadge status={node.status} />
      </div>
      {entries.length > 0 && (
        <dl className="mt-2 space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[auto_1fr] gap-x-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Details evidence={node.evidence} reasons={node.reasons} />
    </div>
  );
}

function Canvas({ graph, filter }: { graph: Graph; filter: MaterializedFilter }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [mode, setMode] = useState<CanvasColorMode>("family");
  const [selected, setSelected] = useState<MaterializedNode | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w < 1) return;
      setWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const elements = useMemo(() => buildCanvasElements(graph, filter, mode), [graph, filter, mode]);
  const onNodeClick = useCallback(
    (node: GraphNode) => setSelected(graph.nodes.find((n) => n.id === node.id) ?? null),
    [graph.nodes],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(elements.colorMap).map(([label, hex]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: hex }} aria-hidden />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <svg width="28" height="6" aria-hidden>
              <line x1="0" y1="3" x2="28" y2="3" stroke={STATUS_HEX.accepted} strokeWidth="2" />
            </svg>
            accepted edge
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="28" height="6" aria-hidden>
              <line x1="0" y1="3" x2="28" y2="3" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            rejected edge
          </span>
        </div>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as CanvasColorMode)}
          className="ml-auto"
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="family" className="text-xs" data-testid="materialized-color-family">
            Colour by family
          </ToggleGroupItem>
          <ToggleGroupItem value="type" className="text-xs" data-testid="materialized-color-type">
            Colour by type
          </ToggleGroupItem>
          <ToggleGroupItem value="status" className="text-xs" data-testid="materialized-color-status">
            Colour by status
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border bg-muted/20"
        style={{ height: GRAPH_HEIGHT }}
        data-testid="materialized-canvas"
      >
        {width !== null && elements.nodes.length > 0 ? (
          <GraphVisualization
            nodes={elements.nodes}
            edges={elements.edges}
            width={width}
            height={GRAPH_HEIGHT}
            colorMap={elements.colorMap}
            onNodeClick={onNodeClick}
            edgeStyleFn={edgeStyleForLabel}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {elements.nodes.length === 0 ? "No nodes match the current filter." : "Measuring…"}
          </p>
        )}
        {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

/**
 * The materialize run, whole: what was accepted into the graph, what was
 * rejected and why, grouped by ontology type and relation, plus the
 * force-directed canvas. Tiles double as status filters, like the schema
 * report's verdict tiles.
 */
export function MaterializedGraph({ graph }: { graph: Graph }) {
  const [statuses, setStatuses] = useState<Set<MaterializedStatus>>(new Set());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MaterializedNode | null>(null);
  const filter = useMemo<MaterializedFilter>(() => ({ statuses, query: query.trim() }), [statuses, query]);

  const nodeGroups = useMemo(() => groupNodesByType(graph.nodes, filter), [graph.nodes, filter]);
  const edgeGroups = useMemo(() => groupEdgesByType(graph.edges, filter), [graph.edges, filter]);
  const visibleNodes = nodeGroups.reduce((n, g) => n + g.nodes.length, 0);
  const visibleEdges = edgeGroups.reduce((n, g) => n + g.edges.length, 0);
  const filtering = statuses.size > 0 || filter.query.length > 0;

  const toggle = (s: MaterializedStatus) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const { coverage } = graph;
  const nothingLanded = coverage.nodes.accepted === 0 && coverage.edges.accepted === 0 && graph.nodes.length > 0;

  return (
    <div className="relative space-y-4" data-testid="materialized-graph">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Nodes accepted" count={coverage.nodes.accepted} status="accepted" active={statuses.has("accepted")} onToggle={() => toggle("accepted")} />
        <StatTile label="Nodes rejected" count={coverage.nodes.rejected} status="rejected" active={statuses.has("rejected")} onToggle={() => toggle("rejected")} />
        <StatTile label="Edges accepted" count={coverage.edges.accepted} status="accepted" active={statuses.has("accepted")} onToggle={() => toggle("accepted")} />
        <StatTile label="Edges rejected" count={coverage.edges.rejected} status="rejected" active={statuses.has("rejected")} onToggle={() => toggle("rejected")} />
      </div>

      {nothingLanded && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600" data-testid="materialized-nothing-landed">
          Nothing was written to the graph: every candidate was rejected. The reasons below say why.
        </p>
      )}

      {graph.reasonCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="materialized-reasons">
          <span className="text-muted-foreground">Rejection reasons</span>
          {graph.reasonCategories.map(({ category, count, variants }) => (
            <button
              key={category}
              type="button"
              onClick={() => setQuery(category)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono hover:bg-muted"
              title={variants > 1 ? `${variants} variants — click to filter` : "Click to filter"}
            >
              {category}
              <span className="text-muted-foreground">{count}</span>
              {variants > 1 && <span className="text-muted-foreground">· {variants} kinds</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, id, type, evidence or reason"
            className="pl-8"
            data-testid="materialized-search"
          />
        </div>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setStatuses(new Set());
              setQuery("");
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
        <p className="ml-auto text-xs text-muted-foreground" data-testid="materialized-count">
          {visibleNodes} of {graph.nodes.length} nodes · {visibleEdges} of {graph.edges.length} edges
        </p>
      </div>

      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Node types</TabsTrigger>
          <TabsTrigger value="edges">Edges</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>
        <TabsContent value="types" className="mt-3 space-y-2">
          {nodeGroups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">No nodes match the current filter.</p>
          ) : (
            nodeGroups.map((group) => <NodeTypeSection key={group.type} group={group} onSelect={setSelected} />)
          )}
        </TabsContent>
        <TabsContent value="edges" className="mt-3 space-y-2">
          {edgeGroups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">No edges match the current filter.</p>
          ) : (
            edgeGroups.map((group) => <EdgeTypeSection key={group.edgeType} group={group} />)
          )}
          {graph.danglingEdges > 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              {graph.danglingEdges} edges reference ids that are not among this run&apos;s nodes; they are listed but not drawn.
            </p>
          )}
        </TabsContent>
        <TabsContent value="graph" className="mt-3">
          <Canvas graph={graph} filter={filter} />
        </TabsContent>
      </Tabs>

      {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">About this run</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {graph.ontologyVersion && (
            <>
              <dt>Ontology</dt>
              <dd className="font-mono">
                {graph.ontologyVersion.hash ? graph.ontologyVersion.hash.slice(0, 12) : "—"}
                {graph.ontologyVersion.typeCount !== null && ` · ${graph.ontologyVersion.typeCount} types`}
                {graph.ontologyVersion.edgeCount !== null && ` · ${graph.ontologyVersion.edgeCount} edges`}
                {graph.ontologyVersion.match === true && " · matches schema sync"}
                {graph.ontologyVersion.match === false && " · DIFFERS from schema sync"}
              </dd>
            </>
          )}
          {(coverage.observedNodeTypes !== null || coverage.allowedNodeTypes !== null) && (
            <>
              <dt>Coverage</dt>
              <dd>
                {coverage.observedNodeTypes ?? 0} of {coverage.allowedNodeTypes ?? "?"} node types · {coverage.observedEdgeTypes ?? 0} of{" "}
                {coverage.allowedEdgeTypes ?? "?"} edge types observed
              </dd>
            </>
          )}
          {graph.swarmUrl && (
            <>
              <dt>Swarm</dt>
              <dd className="font-mono">{graph.swarmUrl}</dd>
            </>
          )}
          {graph.sessionId && (
            <>
              <dt>Session</dt>
              <dd className="font-mono">{graph.sessionId}</dd>
            </>
          )}
          {graph.note && (
            <>
              <dt>Note</dt>
              <dd>{graph.note}</dd>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
