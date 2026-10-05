"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import type {
  SystemMapDomainNode,
  SystemMapDomainNodesResponse,
  SystemMapEndpointLinksResponse,
} from "@/types/system-map";
import { buildEndpointBundles } from "./bundles";
import { DomainGraph, formatValue, shortType } from "./DomainGraph";

const ALL = "__all__";

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

function matchesSearch(node: SystemMapDomainNode, query: string): boolean {
  return (
    node.name.toLowerCase().includes(query) ||
    node.type.toLowerCase().includes(query) ||
    Object.values(node.properties).some((value) => formatValue(value).toLowerCase().includes(query))
  );
}

export function DomainNodesTab() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SystemMapDomainNodesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<LinksState>({ status: "loading" });
  const [showBundles, setShowBundles] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadNodes = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/nodes`);
      if (!response.ok) throw new Error("Failed to load domain nodes");
      setData((await response.json()) as SystemMapDomainNodesResponse);
    } catch (error) {
      toast.error("Could not load domain nodes", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setData(LOAD_FAILED);
    } finally {
      setLoading(false);
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
      void loadNodes(slug);
      void loadLinks(slug);
    },
    [loadNodes, loadLinks],
  );

  useEffect(() => {
    if (workspace?.slug) reload(workspace.slug);
  }, [workspace?.slug, reload]);

  const nodes = useMemo(() => (data?.status === "ready" ? data.nodes : []), [data]);
  const edges = useMemo(() => (data?.status === "ready" ? data.edges : []), [data]);
  const types = useMemo(() => (data?.status === "ready" ? data.types : []), [data]);

  const bundles = useMemo(
    () => (links.status === "ready" ? buildEndpointBundles(links.links) : []),
    [links],
  );
  const endpointsById = useMemo(
    () => new Map((links.status === "ready" ? links.endpoints : []).map((endpoint) => [endpoint.refId, endpoint])),
    [links],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nodes.filter(
      (node) =>
        (typeFilter === ALL || node.type === typeFilter) && (!query || matchesSearch(node, query)),
    );
  }, [nodes, search, typeFilter]);

  const ready = !loading && data?.status === "ready";

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Nodes in the knowledge graph&apos;s <code>systemmap</code> namespace, how they connect, and
          the endpoints between them.
        </p>
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

      {loading && (
        <Card data-testid="system-map-nodes-loading">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the System Map graph…
          </CardContent>
        </Card>
      )}

      {!loading && data?.status === "error" && (
        <Card data-testid="system-map-nodes-error">
          <CardContent className="py-10 text-sm text-muted-foreground">
            {data.error || "Could not load domain nodes from the knowledge graph."}
          </CardContent>
        </Card>
      )}

      {ready && nodes.length === 0 && (
        <Card data-testid="system-map-nodes-empty">
          <CardContent className="py-10 text-sm text-muted-foreground">
            No nodes in the <code>systemmap</code> namespace yet. Run the Materialize workflow
            to write them.
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

      {ready && nodes.length > 0 && (
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
