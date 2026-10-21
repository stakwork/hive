"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SystemMapReport } from "@/components/system-map/SystemMapReport";
import { parseSystemMapReport } from "@/components/system-map/SystemMapReport/model";
import { MaterializedGraph } from "@/components/system-map/MaterializedGraph";
import { parseMaterializedGraph } from "@/components/system-map/MaterializedGraph/model";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { SystemMapRun, SystemMapRunsResponse, SystemMapWorkflowKey } from "@/types/system-map";

/** Per-tab copy. The workflow names come from the API response. */
const COPY: Record<SystemMapWorkflowKey, { description: string; button: string; empty: string; started: string }> = {
  system_map: {
    description:
      "Syncs the Sys* ontology, materializes the real system nodes and edges, and links cloud resources in this workspace's knowledge graph, in one run.",
    button: "Run system map",
    empty: "No runs yet. Start one to map this workspace's system graph.",
    started: "System map started",
  },
  cwe_check: {
    description: "Writes this workspace's security graph into the knowledge graph's infosec namespace.",
    button: "Run CWE check",
    empty: "No runs yet. Start one to build this workspace's security graph.",
    started: "CWE check started",
  },
  finding_verify: {
    description: "Checks whether a finding is real by reproducing it on one of this workspace's pods.",
    button: "Check on pod",
    empty: "Not checked yet.",
    started: "Finding check started",
  },
};

/** Poll cadence while a run is in flight. */
const POLL_MS = 5_000;
/** Output keys that carry a human-readable report, in order of preference. */
const REPORT_KEYS = ["markdown", "report", "summary", "text", "result"] as const;

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

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Split a workflow output into a report (markdown) and the rest (JSON).
 * A string output is the report; an object's first `REPORT_KEYS` string
 * field is, with the remaining fields shown as data.
 */
function splitOutput(output: unknown): { report: string | null; data: unknown } {
  if (typeof output === "string") return { report: output, data: null };
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    for (const key of REPORT_KEYS) {
      if (typeof record[key] === "string" && record[key]) {
        const { [key]: _report, ...rest } = record;
        return { report: record[key] as string, data: Object.keys(rest).length > 0 ? rest : null };
      }
    }
  }
  return { report: null, data: output ?? null };
}

function RunOutput({ run, workflowKey }: { run: SystemMapRun; workflowKey: SystemMapWorkflowKey }) {
  // Each workflow has a first-choice renderer; the other is tried next so a
  // workflow that returns the other shape still gets a real view.
  const structured = useMemo(() => {
    if (run.status !== "SUCCESS") return null;
    const asReport = () => {
      const r = parseSystemMapReport(run.output);
      return r ? (<SystemMapReport report={r} />) : null;
    };
    const asGraph = () => {
      const g = parseMaterializedGraph(run.output);
      return g ? (<MaterializedGraph graph={g} />) : null;
    };
    return workflowKey === "system_map" ? asGraph() ?? asReport() : asReport() ?? asGraph();
  }, [run.output, run.status, workflowKey]);
  const { report, data } = useMemo(() => splitOutput(run.output), [run.output]);

  if (run.status === "PENDING") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Strut is running the workflow…
      </p>
    );
  }
  if (run.status !== "SUCCESS") {
    return (
      <p className="text-sm text-destructive" data-testid="system-map-run-error">
        {run.error || "The run did not finish."}
      </p>
    );
  }
  if (structured) {
    return structured;
  }
  if (report === null && data === null) {
    return <p className="text-sm text-muted-foreground">The workflow finished without output.</p>;
  }
  return (
    <div className="space-y-3">
      {report !== null && (
        <div data-testid="system-map-run-report">
          <MarkdownRenderer size="compact">{report}</MarkdownRenderer>
        </div>
      )}
      {data !== null && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Output data</summary>
          <pre
            className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
            data-testid="system-map-run-data"
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function RunCard({
  run,
  defaultExpanded,
  workflowKey,
}: {
  run: SystemMapRun;
  defaultExpanded: boolean;
  workflowKey: SystemMapWorkflowKey;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Card data-testid="system-map-run">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse run" : "Expand run"}
            data-testid="system-map-run-toggle"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
          <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
          <span className="text-muted-foreground">{formatWhen(run.createdAt)}</span>
          {run.durationMs !== null && (
            <span className="text-muted-foreground">· {formatDuration(run.durationMs)}</span>
          )}
          {run.cweIds && (
            <span
              className="max-w-md truncate font-mono text-xs text-muted-foreground"
              title={run.cweIds.join(", ")}
              data-testid="system-map-run-cwes"
            >
              · {run.cweIds.length > 3 ? `${run.cweIds.slice(0, 3).join(", ")} +${run.cweIds.length - 3}` : run.cweIds.join(", ")}
            </span>
          )}
          {run.components && (
            <span
              className="max-w-xs truncate text-xs text-muted-foreground"
              title={run.components.join(", ")}
              data-testid="system-map-run-components"
            >
              · on {run.components.length > 2 ? `${run.components.slice(0, 2).join(", ")} +${run.components.length - 2}` : run.components.join(", ")}
            </span>
          )}
          {run.findingRefIds && run.findingRefIds.length > 1 && (
            <span className="text-xs text-muted-foreground" data-testid="system-map-run-findings">
              · {run.findingRefIds.length} findings
            </span>
          )}
          {run.apply !== null && (
            <span className="text-xs text-muted-foreground" data-testid="system-map-run-apply">
              · {run.apply ? "writes verdict" : "dry run"}
            </span>
          )}
          {run.strutUrl && (
            <Link
              href={run.strutUrl}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              data-testid="system-map-run-link"
            >
              Open in strut
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {expanded && <RunOutput run={run} workflowKey={workflowKey} />}
      </CardContent>
    </Card>
  );
}

/** How many runs the compact view shows before "Show all". */
const COMPACT_LIMIT = 3;

export function SystemMapRuns({
  workflowKey = "system_map",
  onRunSettled,
  compact = false,
  refreshKey = 0,
}: {
  workflowKey?: SystemMapWorkflowKey;
  /** Called when a run that was in flight finishes (any outcome). */
  onRunSettled?: () => void;
  /**
   * For a tab that launches runs itself: no description or Run button, the
   * newest few runs collapsed, the rest behind "Show all".
   */
  compact?: boolean;
  /** Bump to re-read the runs, e.g. after the host started one. */
  refreshKey?: number;
}) {
  const copy = COPY[workflowKey];
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const [data, setData] = useState<SystemMapRunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (workspaceSlug: string) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/runs?workflow=${workflowKey}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to load runs");
      setData((await response.json()) as SystemMapRunsResponse);
    } catch (error) {
      toast.error("Could not load system map runs", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [workflowKey]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    if (slug) void load(slug);
  }, [slug, load]);

  useEffect(() => {
    if (slug && refreshKey > 0) void load(slug);
  }, [slug, refreshKey, load]);

  const runs = useMemo(() => data?.runs ?? [], [data?.runs]);
  const inFlight = runs.some((run) => run.status === "PENDING");

  useEffect(() => {
    if (!slug || !inFlight) return;
    const timer = setInterval(() => void load(slug), POLL_MS);
    return () => clearInterval(timer);
  }, [slug, inFlight, load]);

  const wasInFlight = useRef(false);
  useEffect(() => {
    if (wasInFlight.current && !inFlight) onRunSettled?.();
    wasInFlight.current = inFlight;
  }, [inFlight, onRunSettled]);

  const start = useCallback(async () => {
    if (!slug) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: workflowKey }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start the workflow");
      toast.success(copy.started);
      await load(slug);
    } catch (error) {
      toast.error("Could not start the run", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, load, workflowKey, copy.started]);

  if (compact) {
    const shown = showAll ? runs : runs.slice(0, COMPACT_LIMIT);
    return (
      <div className="space-y-2" data-testid="system-map-runs-compact">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Runs</p>
          {inFlight && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Running
            </Badge>
          )}
          {data?.workflow && <code className="text-xs text-muted-foreground">{data.workflow}</code>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            disabled={!slug || loading}
            onClick={() => slug && void load(slug)}
            data-testid="system-map-runs-reload"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        {loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="system-map-runs-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading runs…
          </p>
        )}
        {!loading && runs.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="system-map-runs-empty">
            {copy.empty}
          </p>
        )}
        {shown.map((run) => (
          <RunCard key={run.id} run={run} defaultExpanded={false} workflowKey={workflowKey} />
        ))}
        {runs.length > COMPACT_LIMIT && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${runs.length}`}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {copy.description}
            {data?.workflow && (
              <>
                {" "}
                Strut workflow <code>{data.workflow}</code>.
              </>
            )}
          </p>
        </div>
        <Button
          onClick={start}
          disabled={!slug || !canWrite || starting || inFlight}
          className="ml-auto"
          data-testid="system-map-run-button"
        >
          {starting || inFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {inFlight ? "Running…" : copy.button}
        </Button>
      </div>

      {loading && (
        <Card data-testid="system-map-runs-loading">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading runs…
          </CardContent>
        </Card>
      )}

      {!loading && runs.length === 0 && (
        <Card data-testid="system-map-runs-empty">
          <CardContent className="py-10 text-sm text-muted-foreground">
            {copy.empty}
          </CardContent>
        </Card>
      )}

      {runs.map((run, index) => (
        <RunCard key={run.id} run={run} defaultExpanded={index === 0} workflowKey={workflowKey} />
      ))}
    </div>
  );
}
