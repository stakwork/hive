"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SystemMapReport } from "@/components/system-map/SystemMapReport";
import { parseSystemMapReport } from "@/components/system-map/SystemMapReport/model";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { SystemMapRun, SystemMapRunsResponse } from "@/types/system-map";

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

function RunOutput({ run }: { run: SystemMapRun }) {
  const structured = useMemo(() => parseSystemMapReport(run.output), [run.output]);
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
    return <SystemMapReport report={structured} />;
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

function RunCard({ run, defaultExpanded }: { run: SystemMapRun; defaultExpanded: boolean }) {
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
        {expanded && <RunOutput run={run} />}
      </CardContent>
    </Card>
  );
}

export function SystemMapRuns() {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const [data, setData] = useState<SystemMapRunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (workspaceSlug: string) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/runs`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load runs");
      setData((await response.json()) as SystemMapRunsResponse);
    } catch (error) {
      toast.error("Could not load system map runs", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slug) void load(slug);
  }, [slug, load]);

  const runs = useMemo(() => data?.runs ?? [], [data?.runs]);
  const inFlight = runs.some((run) => run.status === "PENDING");

  useEffect(() => {
    if (!slug || !inFlight) return;
    const timer = setInterval(() => void load(slug), POLL_MS);
    return () => clearInterval(timer);
  }, [slug, inFlight, load]);

  const start = useCallback(async () => {
    if (!slug) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start the workflow");
      toast.success("System map run started");
      await load(slug);
    } catch (error) {
      toast.error("Could not start the system map run", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, load]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Runs the <code>{data?.workflow ?? "swarm-systemmap-schema-sync"}</code> strut workflow on the org swarm and
            shows what it reports.
          </p>
        </div>
        <Button
          onClick={start}
          disabled={!slug || !canWrite || starting || inFlight}
          className="ml-auto"
          data-testid="system-map-run-button"
        >
          {starting || inFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {inFlight ? "Running…" : "Run system map"}
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
            No runs yet. Start one to map this workspace&apos;s systems.
          </CardContent>
        </Card>
      )}

      {runs.map((run, index) => (
        <RunCard key={run.id} run={run} defaultExpanded={index === 0} />
      ))}
    </div>
  );
}
