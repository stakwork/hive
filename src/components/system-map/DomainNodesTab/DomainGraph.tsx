"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";
import { nodeTypeColorMap } from "@/components/system-map/MaterializedGraph/model";
import type { SystemMapDomainEdge, SystemMapDomainNode, SystemMapEndpoint } from "@/types/system-map";
import { bundleLabel, type BundleSide, type EndpointBundle } from "./bundles";

const GRAPH_HEIGHT = 620;
const BUNDLE_TYPE = "Endpoints";
const BUNDLE_COLOR = "#64748b";
/** Bundle edges carry this label prefix so they can be drawn dashed. */
const BUNDLE_EDGE_PREFIX = "endpoints:";
const FILTER_FROM = 10;

/** `SysWebApplication` -> `WebApplication`; the full type stays on the tooltip. */
export function shortType(type: string): string {
  return type.replace(/^Sys(?=[A-Z])/, "");
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function edgeStyle(label: string) {
  return label.startsWith(BUNDLE_EDGE_PREFIX)
    ? { stroke: BUNDLE_COLOR, strokeWidth: 1.5, strokeDasharray: "4 3" }
    : { stroke: "#94a3b8", strokeWidth: 1.5 };
}

/** The canvas edge between a bundle's side node and the bundle, pointing the way the link points. */
function bundleEdge(bundle: EndpointBundle, side: BundleSide): GraphEdge {
  const label = `${BUNDLE_EDGE_PREFIX}${side.edgeType}`;
  return side.direction === "out"
    ? { source: side.node, target: bundle.id, label }
    : { source: bundle.id, target: side.node, label };
}

interface Connection {
  direction: "out" | "in";
  edgeType: string;
  node: SystemMapDomainNode;
}

function PanelShell({
  title,
  subtitle,
  onClose,
  children,
  testId,
}: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      className="absolute right-3 top-3 z-10 w-80 max-w-[70%] overflow-y-auto overscroll-contain rounded-lg border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      style={{ maxHeight: "calc(100% - 1.5rem)" }}
      data-testid={testId}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="font-mono text-muted-foreground">{subtitle}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

function DirectionIcon({ direction }: { direction: "out" | "in" }) {
  return direction === "out" ? (
    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="outgoing" />
  ) : (
    <ArrowLeft className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="incoming" />
  );
}

function NodePanel({
  node,
  connections,
  bundles,
  byRef,
  onSelect,
  onClose,
}: {
  node: SystemMapDomainNode;
  connections: Connection[];
  bundles: EndpointBundle[];
  byRef: Map<string, SystemMapDomainNode>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const entries = Object.entries(node.properties)
    .filter(([key, value]) => key !== "name" && value !== null && value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return (
    <PanelShell
      testId="system-map-node-detail"
      onClose={onClose}
      title={<p className="truncate" title={node.name}>{node.name}</p>}
      subtitle={<span title={node.type}>{shortType(node.type)} · {node.refId}</span>}
    >
      {bundles.length > 0 && (
        <div className="mt-3" data-testid="system-map-node-bundles">
          <p className="mb-1 font-medium">Endpoints ({bundles.length} bundles)</p>
          <ul className="space-y-1">
            {bundles.map((bundle) => {
              const mine = bundle.from.node === node.refId ? bundle.from : bundle.to!;
              const other = bundle.from.node === node.refId ? bundle.to : bundle.from;
              return (
                <li key={bundle.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 text-left hover:underline"
                    onClick={() => onSelect(bundle.id)}
                  >
                    <span className="shrink-0 font-mono text-muted-foreground">{mine.edgeType}</span>
                    <span className="shrink-0">{bundle.endpoints.length}</span>
                    {other ? (
                      <span className="truncate">
                        <span className="font-mono text-muted-foreground">{other.edgeType}</span>{" "}
                        {byRef.get(other.node)?.name ?? other.node}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">no other System Map node</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {connections.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 font-medium">Connections ({connections.length})</p>
          <ul className="space-y-1">
            {connections.map((connection) => (
              <li key={`${connection.direction}|${connection.edgeType}|${connection.node.refId}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-left hover:underline"
                  onClick={() => onSelect(connection.node.refId)}
                >
                  <DirectionIcon direction={connection.direction} />
                  <span className="shrink-0 font-mono text-muted-foreground">{connection.edgeType}</span>
                  <span className="truncate">{connection.node.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entries.length > 0 && (
        <dl className="mt-3 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[auto_1fr] gap-x-2">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-words">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </PanelShell>
  );
}

function BundlePanel({
  bundle,
  byRef,
  endpointsById,
  onSelect,
  onClose,
}: {
  bundle: EndpointBundle;
  byRef: Map<string, SystemMapDomainNode>;
  endpointsById: Map<string, SystemMapEndpoint>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const endpoints = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return bundle.endpoints
      .map((refId) => endpointsById.get(refId) ?? { refId, name: refId, verb: "", file: "" })
      .filter(
        (endpoint) =>
          !query ||
          endpoint.name.toLowerCase().includes(query) ||
          endpoint.verb.toLowerCase().includes(query) ||
          endpoint.file.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.verb.localeCompare(b.verb));
  }, [bundle, endpointsById, filter]);

  const sideLink = (side: BundleSide) => (
    <button type="button" className="truncate hover:underline" onClick={() => onSelect(side.node)}>
      {byRef.get(side.node)?.name ?? side.node}
    </button>
  );

  return (
    <PanelShell
      testId="system-map-bundle-detail"
      onClose={onClose}
      title={`${bundle.endpoints.length} endpoint${bundle.endpoints.length === 1 ? "" : "s"}`}
      subtitle={bundleLabel(bundle)}
    >
      <div className="mt-2 space-y-1">
        <p className="flex items-center gap-1">
          {sideLink(bundle.from)}
          <span className="shrink-0 font-mono text-muted-foreground">{bundle.from.edgeType}</span>
        </p>
        {bundle.to ? (
          <p className="flex items-center gap-1">
            {sideLink(bundle.to)}
            <span className="shrink-0 font-mono text-muted-foreground">{bundle.to.edgeType}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">No other System Map node links these endpoints.</p>
        )}
      </div>

      {bundle.endpoints.length >= FILTER_FROM && (
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter endpoints"
          className="mt-3 h-7 text-xs"
          data-testid="system-map-bundle-filter"
        />
      )}
      <ul className="mt-2 space-y-0.5" data-testid="system-map-bundle-endpoints">
        {endpoints.map((endpoint) => (
          <li key={endpoint.refId} className="flex items-center gap-1" title={endpoint.file || endpoint.name}>
            {endpoint.verb && <span className="w-12 shrink-0 font-mono text-muted-foreground">{endpoint.verb}</span>}
            <span className="truncate font-mono">{endpoint.name}</span>
          </li>
        ))}
        {endpoints.length === 0 && <li className="text-muted-foreground">No endpoints match.</li>}
      </ul>
    </PanelShell>
  );
}

/**
 * The System Map nodes on a force-directed canvas, coloured by type, with
 * endpoint bundles drawn as grey group nodes between the nodes they link.
 * Clicking a node opens its connections and bundles; clicking a bundle lists
 * its endpoints.
 */
export function DomainGraph({
  nodes,
  allNodes,
  edges,
  bundles,
  endpointsById,
  selectedId,
  onSelect,
  height = GRAPH_HEIGHT,
}: {
  /** The nodes passing the current filters. */
  nodes: SystemMapDomainNode[];
  /** Every node, so a connection to a filtered-out node still resolves. */
  allNodes: SystemMapDomainNode[];
  edges: SystemMapDomainEdge[];
  /** Bundles to draw; one whose nodes are all filtered out is skipped. Pass `[]` when the caller has no endpoint-bundle concept (e.g. the infosec graph). */
  bundles: EndpointBundle[];
  /** Pass an empty `Map` when the caller has no endpoints to resolve bundle labels against. */
  endpointsById: Map<string, SystemMapEndpoint>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Canvas height in px. Defaults to the Domain nodes tab's fixed 620 — callers in a narrower panel (the workflow inspector) should pass something responsive to their own layout. */
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

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

  const elements = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.refId));
    const graphNodes: GraphNode[] = nodes.map((node) => ({ id: node.refId, name: node.name, type: shortType(node.type) }));
    const graphEdges: GraphEdge[] = edges.map((edge) => ({ source: edge.source, target: edge.target, label: edge.edgeType }));
    const typeColors = nodeTypeColorMap([...new Set(graphNodes.map((node) => node.type))]);

    let bundleCount = 0;
    for (const bundle of bundles) {
      const fromShown = ids.has(bundle.from.node);
      const toShown = bundle.to !== null && ids.has(bundle.to.node);
      if (!fromShown && !toShown) continue;
      bundleCount++;
      graphNodes.push({ id: bundle.id, name: bundleLabel(bundle), type: BUNDLE_TYPE });
      if (fromShown) graphEdges.push(bundleEdge(bundle, bundle.from));
      if (toShown) graphEdges.push(bundleEdge(bundle, bundle.to!));
    }
    const shown = new Set(graphNodes.map((node) => node.id));
    return {
      nodes: graphNodes,
      edges: graphEdges.filter((edge) => shown.has(edge.source) && shown.has(edge.target)),
      colorMap: bundleCount > 0 ? { ...typeColors, [BUNDLE_TYPE]: BUNDLE_COLOR } : typeColors,
      bundleCount,
    };
  }, [nodes, edges, bundles]);

  const byRef = useMemo(() => new Map(allNodes.map((node) => [node.refId, node])), [allNodes]);
  const bundleById = useMemo(() => new Map(bundles.map((bundle) => [bundle.id, bundle])), [bundles]);
  const selectedNode = selectedId ? byRef.get(selectedId) ?? null : null;
  const selectedBundle = selectedId ? bundleById.get(selectedId) ?? null : null;

  const connections = useMemo<Connection[]>(() => {
    if (!selectedNode) return [];
    const list: Connection[] = [];
    for (const edge of edges) {
      const outgoing = edge.source === selectedNode.refId;
      if (!outgoing && edge.target !== selectedNode.refId) continue;
      const other = byRef.get(outgoing ? edge.target : edge.source);
      if (other) list.push({ direction: outgoing ? "out" : "in", edgeType: edge.edgeType, node: other });
    }
    return list.sort((a, b) => a.edgeType.localeCompare(b.edgeType) || a.node.name.localeCompare(b.node.name));
  }, [selectedNode, edges, byRef]);

  const nodeBundles = useMemo(
    () =>
      selectedNode
        ? bundles.filter((bundle) => bundle.from.node === selectedNode.refId || bundle.to?.node === selectedNode.refId)
        : [],
    [selectedNode, bundles],
  );

  const onNodeClick = useCallback(
    (node: GraphNode) => {
      if (byRef.has(node.id) || bundleById.has(node.id)) onSelect(node.id);
    },
    [byRef, bundleById, onSelect],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="system-map-graph-legend">
        {Object.entries(elements.colorMap).map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
            {type}
          </span>
        ))}
        <span className="ml-auto">
          {elements.nodes.length - elements.bundleCount} nodes
          {elements.bundleCount > 0 && ` · ${elements.bundleCount} endpoint bundles`} · {elements.edges.length} edges
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border bg-muted/20"
        style={{ height }}
        data-testid="system-map-graph"
      >
        {width !== null && elements.nodes.length > 0 ? (
          <GraphVisualization
            nodes={elements.nodes}
            edges={elements.edges}
            width={width}
            height={height}
            colorMap={elements.colorMap}
            onNodeClick={onNodeClick}
            edgeStyleFn={edgeStyle}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {elements.nodes.length === 0 ? "No nodes match the current filter." : "Measuring…"}
          </p>
        )}
        {selectedNode && (
          <NodePanel
            node={selectedNode}
            connections={connections}
            bundles={nodeBundles}
            byRef={byRef}
            onSelect={onSelect}
            onClose={() => onSelect(null)}
          />
        )}
        {selectedBundle && (
          <BundlePanel
            key={selectedBundle.id}
            bundle={selectedBundle}
            byRef={byRef}
            endpointsById={endpointsById}
            onSelect={onSelect}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
    </div>
  );
}
