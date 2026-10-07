"use client";

/**
 * The workflow inspector's SystemMap tab: a Start Run button for
 * `swarm-systemmap-cwe-check-templates` (System Map's `cwe_check` kind)
 * plus a graph of the workspace's `infosec` namespace.
 *
 * Shares the run pipeline with `SystemMapRuns` (same runs route, same
 * `SystemMapRun` shape) but tracks the EXACT run the 202 returned rather
 * than polling "any PENDING run of this kind" — the inspector is a narrower
 * surface where a stray concurrent run (another tab, another user) must not
 * be mistaken for this one. Polls `?runId=` (run-scoped, IDOR-checked
 * server-side) and refreshes the graph exactly once on the pending→settled
 * transition it detects.
 *
 * The graph endpoint is a workspace namespace snapshot, not run-addressed
 * output — copy here is careful to say "latest infosec state as of <time>",
 * never "this run produced this graph".
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { DomainGraph } from "@/components/system-map/DomainNodesTab/DomainGraph";
import type {
  SystemMapDomainNodesResponse,
  SystemMapRun,
} from "@/types/system-map";

/** The System Map workflow key this tab launches (`src/services/strut-runs/system-map.ts`). */
const WORKFLOW_KEY = "cwe_check";
/** Poll cadence while a run is in flight — matches `SystemMapRuns`. */
const POLL_MS = 5_000;
/** Give up polling a run after this long and tell the user to check back. */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const EMPTY_BUNDLES: never[] = [];
const EMPTY_ENDPOINTS_BY_ID = new Map<string, never>();

const STATUS_LABEL: Record<SystemMapRun["status"], string> = {
  PENDING: "Running",
  SUCCESS: "Succeeded",
  ERROR: "Failed",
  CANCELLED: "Cancelled",
  LOST: "Lost",
};

const STATUS_VARIANT: Record<SystemMapRun["status"], "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  SUCCESS: "default",
  ERROR: "destructive",
  CANCELLED: "outline",
  LOST: "destructive",
};

function isSystemMapDomainNodesResponse(value: unknown): value is SystemMapDomainNodesResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.status !== "ready" && v.status !== "error") return false;
  if (v.status === "ready") {
    return Array.isArray(v.nodes) && Array.isArray(v.edges) && Array.isArray(v.types);
  }
  return true;
}

export function WorkflowSystemMapTab() {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;

  const [starting, setStarting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [run, setRun] = useState<SystemMapRun | null>(null);

  const [graph, setGraph] = useState<SystemMapDomainNodesResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphRefreshedAt, setGraphRefreshedAt] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pollStartedAt = useRef<number | null>(null);
  const lastStatusRef = useRef<SystemMapRun["status"] | null>(null);

  const loadGraph = useCallback(async (workspaceSlug: string) => {
    setGraphLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/infosec-nodes`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      if (!isSystemMapDomainNodesResponse(body)) {
        throw new Error("Unexpected response shape from the infosec graph endpoint");
      }
      setGraph(body);
      setGraphRefreshedAt(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      setGraph({
        status: "error",
        types: [],
        nodes: [],
        edges: [],
        truncated: false,
        edgeReadFailures: 0,
        error: message,
      });
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slug) void loadGraph(slug);
  }, [slug, loadGraph]);

  // Run-scoped status poll: only the exact run the 202 named, never "any
  // pending run of this kind" — a stray concurrent run must not look like
  // this one settling.
  const pollRun = useCallback(
    async (workspaceSlug: string, runId: string) => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/runs?runId=${encodeURIComponent(runId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { run?: SystemMapRun };
        if (!body.run) return;
        setRun(body.run);
      } catch {
        // Transient poll failure — try again next tick rather than surfacing an error.
      }
    },
    [],
  );

  useEffect(() => {
    if (!slug || !activeRunId) return;
    pollStartedAt.current = pollStartedAt.current ?? Date.now();
    void pollRun(slug, activeRunId);
    const timer = setInterval(() => {
      if (Date.now() - (pollStartedAt.current ?? Date.now()) > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        toast.error("Still running", { description: "The run is taking longer than expected. Check back shortly." });
        return;
      }
      void pollRun(slug, activeRunId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [slug, activeRunId, pollRun]);

  // One pending→settled transition: refetch the graph exactly once.
  useEffect(() => {
    if (!run) return;
    const prev = lastStatusRef.current;
    lastStatusRef.current = run.status;
    if (prev === "PENDING" && run.status !== "PENDING" && slug) {
      void loadGraph(slug);
      pollStartedAt.current = null;
    }
  }, [run, slug, loadGraph]);

  const start = useCallback(async () => {
    if (!slug || starting) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: WORKFLOW_KEY }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; runId?: string };
      if (response.status === 409) {
        toast.error("A run is already in progress", {
          description: "Wait for it to finish before starting another.",
        });
        return;
      }
      if (response.status === 429) {
        toast.error("Too many runs", { description: body.error || "Try again later." });
        return;
      }
      if (response.status === 503) {
        toast.error("Swarm unavailable", { description: body.error || "Could not reach the workspace swarm." });
        return;
      }
      if (body.code === "workflow_missing") {
        toast.error("Workflow not available", {
          description: "This strut hasn't been seeded with the CWE check workflow yet.",
        });
        return;
      }
      if (!response.ok || !body.runId) {
        throw new Error(body.error || "Could not start the run");
      }
      lastStatusRef.current = "PENDING";
      pollStartedAt.current = Date.now();
      setActiveRunId(body.runId);
      setRun(null);
      toast.success("CWE check started");
    } catch (error) {
      toast.error("Could not start the run", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, starting]);

  const nodes = useMemo(() => (graph?.status === "ready" ? graph.nodes : []), [graph]);
  const edges = useMemo(() => (graph?.status === "ready" ? graph.edges : []), [graph]);
  const ready = !graphLoading && graph?.status === "ready";
  const inFlight = run?.status === "PENDING";

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Builds and shows this workspace&apos;s <code>infosec</code> security graph.
          </p>
          {run && (
            <div className="mt-1 flex items-center gap-2 text-xs">
              <Badge variant={STATUS_VARIANT[run.status]} data-testid="system-map-workflow-tab-run-status">
                {STATUS_LABEL[run.status]}
              </Badge>
              {run.status !== "SUCCESS" && run.error && (
                <span className="text-destructive" data-testid="system-map-workflow-tab-run-error">
                  {run.error}
                </span>
              )}
            </div>
          )}
        </div>
        {canWrite ? (
          <Button
            size="sm"
            onClick={start}
            disabled={!slug || starting || inFlight}
            data-testid="system-map-workflow-tab-start"
          >
            {starting || inFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {inFlight ? "Running…" : "Start Run"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="system-map-workflow-tab-readonly">
            Developer access is required to start a run.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="system-map-workflow-tab-refreshed-at">
          {graphRefreshedAt
            ? `Latest infosec namespace state as of ${graphRefreshedAt.toLocaleTimeString()}`
            : "Loading the infosec namespace…"}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={graphLoading || !slug}
          onClick={() => slug && loadGraph(slug)}
          data-testid="system-map-workflow-tab-refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${graphLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {graphLoading && (
        <Card data-testid="system-map-workflow-tab-loading">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the infosec graph…
          </CardContent>
        </Card>
      )}

      {!graphLoading && graph?.status === "error" && (
        <Card data-testid="system-map-workflow-tab-error">
          <CardContent className="py-8 text-sm text-muted-foreground">
            {graph.error || "Could not load the infosec graph."}
          </CardContent>
        </Card>
      )}

      {ready && nodes.length === 0 && (
        <Card data-testid="system-map-workflow-tab-empty">
          <CardContent className="py-8 text-sm text-muted-foreground">
            No nodes in the <code>infosec</code> namespace yet. Start a run to build it.
          </CardContent>
        </Card>
      )}

      {ready && graph.status === "ready" && (graph.truncated || graph.edgeReadFailures > 0) && (
        <p className="text-xs text-muted-foreground" data-testid="system-map-workflow-tab-partial">
          {graph.truncated && "The graph has more infosec nodes than this view loads. "}
          {graph.edgeReadFailures > 0 &&
            `Connections could not be read for ${graph.edgeReadFailures} node${graph.edgeReadFailures === 1 ? "" : "s"}. `}
          The view is partial.
        </p>
      )}

      {ready && nodes.length > 0 && (
        <DomainGraph
          nodes={nodes}
          allNodes={nodes}
          edges={edges}
          bundles={EMPTY_BUNDLES}
          endpointsById={EMPTY_ENDPOINTS_BY_ID}
          selectedId={selectedId}
          onSelect={setSelectedId}
          height={360}
        />
      )}
    </div>
  );
}
