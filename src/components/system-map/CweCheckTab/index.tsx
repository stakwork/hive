"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DomainGraph } from "@/components/system-map/DomainNodesTab/DomainGraph";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";
import type { SystemMapDomainNodesResponse } from "@/types/system-map";

const GRAPH_HEIGHT = 560;
const NO_BUNDLES: never[] = [];
const NO_ENDPOINTS = new Map<string, never>();

/**
 * The System Map page's CWE check tab: runs `swarm-systemmap-cwe-check-templates`
 * (the `cwe_check` System Map workflow) and shows the `infosec` namespace it
 * writes, reloading the graph when a run finishes.
 */
export function CweCheckTab() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [graph, setGraph] = useState<SystemMapDomainNodesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadGraph = useCallback(async (workspaceSlug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/infosec-nodes`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setGraph((await response.json()) as SystemMapDomainNodesResponse);
    } catch (error) {
      setGraph({
        status: "error",
        types: [],
        nodes: [],
        edges: [],
        truncated: false,
        edgeReadFailures: 0,
        error: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slug) void loadGraph(slug);
  }, [slug, loadGraph]);

  const onRunSettled = useCallback(() => {
    if (slug) void loadGraph(slug);
  }, [slug, loadGraph]);

  const nodes = graph?.status === "ready" ? graph.nodes : [];
  const ready = !loading && graph?.status === "ready";

  return (
    <div className="space-y-6">
      <SystemMapRuns workflowKey="cwe_check" onRunSettled={onRunSettled} />

      <div className="max-w-6xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Security graph (<code>infosec</code> namespace)
          </h3>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !slug}
            onClick={() => slug && void loadGraph(slug)}
            data-testid="cwe-check-refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        {loading && (
          <Card data-testid="cwe-check-loading">
            <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading the infosec graph…
            </CardContent>
          </Card>
        )}

        {!loading && graph?.status === "error" && (
          <Card data-testid="cwe-check-error">
            <CardContent className="py-8 text-sm text-muted-foreground">
              {graph.error || "Could not load the infosec graph."}
            </CardContent>
          </Card>
        )}

        {ready && nodes.length === 0 && (
          <Card data-testid="cwe-check-empty">
            <CardContent className="py-8 text-sm text-muted-foreground">
              No nodes in the <code>infosec</code> namespace yet. Run a CWE check to build it.
            </CardContent>
          </Card>
        )}

        {ready && (graph.truncated || graph.edgeReadFailures > 0) && (
          <p className="text-xs text-muted-foreground" data-testid="cwe-check-partial">
            Some nodes or connections could not be loaded; the graph is partial.
          </p>
        )}

        {ready && nodes.length > 0 && (
          <DomainGraph
            nodes={nodes}
            allNodes={nodes}
            edges={graph.edges}
            bundles={NO_BUNDLES}
            endpointsById={NO_ENDPOINTS}
            selectedId={selectedId}
            onSelect={setSelectedId}
            height={GRAPH_HEIGHT}
          />
        )}
      </div>
    </div>
  );
}
