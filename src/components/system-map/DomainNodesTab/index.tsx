"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DEFAULT_NODE_TYPES, ON_DEMAND_NODE_TYPES } from "@/lib/system-map/node-types";
import type {
  SystemMapDomainNode,
  SystemMapDomainNodesResponse,
  SystemMapEndpointLinksResponse,
} from "@/types/system-map";
import { buildEndpointBundles } from "./bundles";
import { DomainGraph, formatValue, shortType } from "./DomainGraph";
import { buildArchitecture, PACKAGE_TYPE } from "./architecture";
import { buildDependencies, pullsIn } from "./dependencies";
import { ArchitectureView } from "./ArchitectureView";
import { buildMapLayout } from "./map-layout";
import { MapView } from "./MapView";
import { DependenciesView, PackageDetails } from "./DependenciesView";
import { NodeDetails } from "./NodeDetails";
import { matchPackageCves } from "./package-cves";
import { PackageCvesBar, type PackageCvesResult } from "./PackageCvesBar";

const ALL = "__all__";

const VIEWS = [
  { key: "architecture", label: "Architecture" },
  { key: "map", label: "Map" },
  { key: "dependencies", label: "Dependencies" },
  { key: "raw", label: "Raw graph" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const LOAD_FAILED: SystemMapDomainNodesResponse = {
  status: "error",
  types: [],
  nodes: [],
  edges: [],
  truncated: false,
  edgeReadFailures: 0,
  error: "Failed to load domain nodes",
};

type LinksState = { status: "loading" } | SystemMapEndpointLinksResponse;

/** The nodes response together with the type allowlist it was read with. */
type NodesState = { response: SystemMapDomainNodesResponse; types: string[] };

function setOf(set: Set<string>, type: string, present: boolean): Set<string> {
  if (set.has(type) === present) return set;
  const next = new Set(set);
  if (present) next.add(type);
  else next.delete(type);
  return next;
}

function matchesSearch(node: SystemMapDomainNode, query: string): boolean {
  return (
    node.name.toLowerCase().includes(query) ||
    node.type.toLowerCase().includes(query) ||
    Object.values(node.properties).some((value) => formatValue(value).toLowerCase().includes(query))
  );
}

export function DomainNodesTab() {
  const { workspace } = useWorkspace();
  const [nodesState, setNodesState] = useState<NodesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<LinksState>({ status: "loading" });
  const [showBundles, setShowBundles] = useState(true);
  // On-demand types the user asked for; the graph is re-read with them. Packages start unread.
  const [wanted, setWanted] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("architecture");
  const [archSelected, setArchSelected] = useState<string | null>(null);
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  const [pkgSelected, setPkgSelected] = useState<string | null>(null);
  const [cveResult, setCveResult] = useState<PackageCvesResult | null>(null);

  const wantedKey = [...wanted].sort().join(",");
  const requestedTypes = useMemo(() => [...DEFAULT_NODE_TYPES, ...wantedKey.split(",").filter(Boolean)], [wantedKey]);

  // The graph is read with a type allowlist (jarvis has no blocklist): the ontology's types minus
  // the on-demand ones, plus whichever of those were asked for. Asking for one re-reads the whole
  // allowlist, so the views keep showing the previous graph until the new one lands.
  const requestSeq = useRef(0);
  const loadNodes = useCallback(async (slug: string, types: string[]) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/system-map/nodes?types=${encodeURIComponent(types.join(","))}`,
      );
      if (!response.ok) throw new Error("Failed to load domain nodes");
      const body = (await response.json()) as SystemMapDomainNodesResponse;
      if (seq === requestSeq.current) setNodesState({ response: body, types });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      toast.error("Could not load domain nodes", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setNodesState({ response: LOAD_FAILED, types });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Separate from the map so the graph renders while the (larger) endpoint query runs.
  const loadLinks = useCallback(async (slug: string) => {
    setLinks({ status: "loading" });
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/endpoint-links`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLinks((await response.json()) as SystemMapEndpointLinksResponse);
    } catch (error) {
      setLinks({
        status: "error",
        links: [],
        endpoints: [],
        truncated: false,
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
  }, []);

  const reload = useCallback(
    (slug: string) => {
      setSelectedId(null);
      setArchSelected(null);
      setMapSelected(null);
      setPkgSelected(null);
      void loadNodes(slug, requestedTypes);
      void loadLinks(slug);
    },
    [loadNodes, loadLinks, requestedTypes],
  );

  useEffect(() => {
    if (workspace?.slug) void loadNodes(workspace.slug, requestedTypes);
  }, [workspace?.slug, requestedTypes, loadNodes]);
  useEffect(() => {
    if (workspace?.slug) void loadLinks(workspace.slug);
  }, [workspace?.slug, loadLinks]);

  const data = nodesState?.response ?? null;
  /** On-demand types the current graph was read with. */
  const loadedTypes = useMemo(() => new Set(nodesState?.types ?? []), [nodesState]);
  const packagesLoaded = loadedTypes.has(PACKAGE_TYPE);
  const want = useCallback((type: string) => setWanted((prev) => setOf(prev, type, true)), []);
  // The Dependencies view is the place packages live, so opening it reads them.
  useEffect(() => {
    if (view === "dependencies") want(PACKAGE_TYPE);
  }, [view, want]);

  const nodes = useMemo(() => (data?.status === "ready" ? data.nodes : []), [data]);
  const edges = useMemo(() => (data?.status === "ready" ? data.edges : []), [data]);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [nodes]);
  const types = useMemo(() => (data?.status === "ready" ? data.types : []), [data]);
  const setRead = useCallback((type: string, read: boolean) => setWanted((prev) => setOf(prev, type, read)), []);

  const bundles = useMemo(() => (links.status === "ready" ? buildEndpointBundles(links.links) : []), [links]);
  const endpointsById = useMemo(
    () => new Map((links.status === "ready" ? links.endpoints : []).map((endpoint) => [endpoint.refId, endpoint])),
    [links],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nodes.filter(
      (node) => (typeFilter === ALL || node.type === typeFilter) && (!query || matchesSearch(node, query)),
    );
  }, [nodes, search, typeFilter]);

  const byRef = useMemo(() => new Map(nodes.map((n) => [n.refId, n])), [nodes]);
  const architecture = useMemo(() => buildArchitecture(nodes, edges), [nodes, edges]);
  const dependencies = useMemo(() => buildDependencies(nodes, edges), [nodes, edges]);
  const mapModel = useMemo(() => buildMapLayout(nodes, edges), [nodes, edges]);
  const cves = useMemo(
    () => (cveResult ? matchPackageCves(cveResult.vulnerable, dependencies.packages, cveResult.checkedAt) : null),
    [cveResult, dependencies.packages],
  );
  const reach = useMemo(() => {
    const cache = new Map<string, number>();
    return (refId: string) => pullsIn(dependencies, refId, cache);
  }, [dependencies]);

  // A node link from a panel: on the Map everything stays on the map; elsewhere packages open in
  // Dependencies and everything else in Architecture.
  const openNode = useCallback(
    (refId: string) => {
      if (view === "map") {
        setMapSelected(refId);
      } else if (byRef.get(refId)?.type === PACKAGE_TYPE) {
        setPkgSelected(refId);
        setView("dependencies");
      } else {
        setArchSelected(refId);
        setView("architecture");
      }
    },
    [byRef, view],
  );
  const openPackages = useCallback(() => setView("dependencies"), []);

  const ready = data?.status === "ready";
  const archNode = archSelected ? byRef.get(archSelected) : undefined;
  const mapNode = mapSelected ? byRef.get(mapSelected) : undefined;
  const mapPkg = mapSelected ? dependencies.byRef.get(mapSelected) : undefined;
  const pkgRow = pkgSelected ? dependencies.byRef.get(pkgSelected) : undefined;

  return (
    <div className={cn("space-y-4", view === "raw" && "max-w-6xl")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Nodes in the knowledge graph&apos;s <code>systemmap</code> namespace, how they connect, and the endpoints
          between them.
        </p>
        {ready && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {ON_DEMAND_NODE_TYPES.map((d) => {
              const loaded = loadedTypes.has(d.type);
              const pulling = wanted.has(d.type) !== loaded && loading;
              const pinned = d.type === PACKAGE_TYPE && view === "dependencies";
              return (
                <label
                  key={d.type}
                  className="flex items-center gap-2"
                  title={
                    pinned
                      ? "The Dependencies view reads packages"
                      : `Read ${d.label} from the graph (re-reads the System Map)`
                  }
                >
                  <Switch
                    checked={wanted.has(d.type)}
                    disabled={pinned}
                    onCheckedChange={(checked) => setRead(d.type, checked)}
                    className="scale-75"
                    data-testid={`system-map-read-${d.type}`}
                  />
                  {loaded ? `${typeCounts.get(d.type) ?? 0} ${d.label}` : d.label}
                  {pulling && <Loader2 className="h-3 w-3 animate-spin" />}
                </label>
              );
            })}
          </div>
        )}
        <div
          className={cn("flex rounded-md bg-muted p-0.5", !ready && "ml-auto")}
          role="tablist"
          data-testid="system-map-view-toggle"
        >
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                "rounded px-3 py-1 text-sm text-muted-foreground",
                view === v.key && "bg-background text-foreground shadow-sm",
              )}
              data-testid={`system-map-view-${v.key}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !workspace?.slug}
          onClick={() => workspace?.slug && reload(workspace.slug)}
          data-testid="system-map-nodes-refresh"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && !data && (
        <Card data-testid="system-map-nodes-loading">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the System Map graph…
          </CardContent>
        </Card>
      )}

      {data?.status === "error" && (
        <Card data-testid="system-map-nodes-error">
          <CardContent className="py-10 text-sm text-muted-foreground">
            {data.error || "Could not load domain nodes from the knowledge graph."}
          </CardContent>
        </Card>
      )}

      {ready && nodes.length === 0 && (
        <Card data-testid="system-map-nodes-empty">
          <CardContent className="py-10 text-sm text-muted-foreground">
            No nodes in the <code>systemmap</code> namespace yet. Run the Materialize workflow to write them.
          </CardContent>
        </Card>
      )}

      {ready && (data.truncated || data.edgeReadFailures > 0) && (
        <p className="text-sm text-muted-foreground" data-testid="system-map-nodes-partial">
          {data.truncated && "The graph has more System Map nodes than this view loads. "}
          {data.edgeReadFailures > 0 &&
            `Connections could not be read for ${data.edgeReadFailures} node${data.edgeReadFailures === 1 ? "" : "s"}. `}
          The view is partial.
        </p>
      )}

      {ready && nodes.length > 0 && view === "architecture" && (
        <ArchitectureView
          model={architecture}
          byRef={byRef}
          selectedId={archSelected}
          onSelect={setArchSelected}
          onOpen={openNode}
          onOpenPackages={openPackages}
          panel={
            archNode && (
              <NodeDetails
                node={archNode}
                edges={edges}
                byRef={byRef}
                lane={architecture.cards.get(archNode.refId)?.lane}
                duplicates={architecture.cards.get(archNode.refId)?.duplicates}
                onOpen={openNode}
                onOpenPackages={openPackages}
                onClose={() => setArchSelected(null)}
              />
            )
          }
        />
      )}

      {ready && nodes.length > 0 && view === "map" && (
        <MapView
          model={mapModel}
          cves={cves}
          selectedId={mapSelected}
          onSelect={setMapSelected}
          panel={
            mapPkg ? (
              <PackageDetails
                row={mapPkg}
                model={dependencies}
                byRef={byRef}
                reach={reach}
                finding={cves?.byPackage.get(mapPkg.node.refId)}
                onOpen={openNode}
                onClose={() => setMapSelected(null)}
              />
            ) : (
              mapNode && (
                <NodeDetails
                  node={mapNode}
                  edges={edges}
                  byRef={byRef}
                  lane={mapModel.nodes.get(mapNode.refId)?.region}
                  duplicates={architecture.cards.get(mapNode.refId)?.duplicates}
                  onOpen={openNode}
                  onOpenPackages={openPackages}
                  onClose={() => setMapSelected(null)}
                />
              )
            )
          }
        />
      )}

      {ready && view === "dependencies" && !packagesLoaded && (
        <Card data-testid="system-map-packages-loading">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading packages from the graph…
          </CardContent>
        </Card>
      )}

      {ready && packagesLoaded && view === "dependencies" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <PackageCvesBar onResult={setCveResult} />
            <DependenciesView
              model={dependencies}
              reach={reach}
              cves={cves}
              selectedId={pkgSelected}
              onSelect={setPkgSelected}
            />
          </div>
          <aside className="h-fit rounded-lg border bg-background p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {pkgRow ? (
              <PackageDetails
                row={pkgRow}
                model={dependencies}
                byRef={byRef}
                reach={reach}
                finding={cves?.byPackage.get(pkgRow.node.refId)}
                onOpen={openNode}
                onClose={() => setPkgSelected(null)}
              />
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="system-map-detail-hint">
                Click a package to see why it is here, what uses it and what it pulls in.
              </p>
            )}
          </aside>
        </div>
      )}

      {ready && nodes.length > 0 && view === "raw" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by name, type or property"
              className="max-w-sm"
              data-testid="system-map-nodes-search"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-56" data-testid="system-map-nodes-type-filter">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.type} value={type.type}>
                    {shortType(type.type)} ({type.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={showBundles}
                onCheckedChange={setShowBundles}
                disabled={links.status !== "ready"}
                data-testid="system-map-bundles-toggle"
              />
              Endpoint bundles
              {links.status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {links.status === "ready" && <span className="text-muted-foreground">({bundles.length})</span>}
            </label>
            <p className="ml-auto text-sm text-muted-foreground" data-testid="system-map-nodes-count">
              {filtered.length} of {nodes.length} nodes
            </p>
          </div>

          {links.status === "error" && (
            <p className="text-sm text-muted-foreground" data-testid="system-map-links-error">
              Could not load endpoint links: {links.error}
            </p>
          )}
          {links.status === "ready" && links.truncated && (
            <p className="text-sm text-muted-foreground" data-testid="system-map-links-truncated">
              The graph has more endpoint links than this view loads; bundles are partial.
            </p>
          )}

          <DomainGraph
            nodes={filtered}
            allNodes={nodes}
            edges={edges}
            bundles={showBundles ? bundles : []}
            endpointsById={endpointsById}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <Card data-testid="system-map-nodes-list">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Ref ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((node) => (
                    <TableRow
                      key={node.refId}
                      className={cn("cursor-pointer", selectedId === node.refId && "bg-muted")}
                      onClick={() => setSelectedId(node.refId)}
                      data-testid="system-map-node-row"
                    >
                      <TableCell className="font-medium">{node.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" title={node.type}>
                          {shortType(node.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{node.refId}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
