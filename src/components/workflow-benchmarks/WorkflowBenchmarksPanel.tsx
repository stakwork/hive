"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WORKFLOW_BENCHMARK_TASKS, type WorkflowBenchmarkTask } from "@/lib/workflow-benchmark-tasks";

// ─── Task Card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: WorkflowBenchmarkTask;
  workspaceSlug: string;
}

function TaskCard({ task, workspaceSlug }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRun = async () => {
    setIsRunning(true);
    setRunError(null);
    setRunId(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/workflow-benchmarks/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskSlug: task.slug }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRunError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setRunId(data.run_id ?? null);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{task.title}</p>
            <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate" title={task.slug}>
              {task.slug}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse task details" : "Expand task details"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-4 pt-1">
            {/* Instructions */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Instructions
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {task.instructions}
              </p>
            </div>

            {/* Criteria */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Criteria ({task.criteria.length})
              </p>
              <ol className="space-y-2">
                {task.criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className="shrink-0 text-xs font-mono mt-0.5 px-1.5 py-0"
                    >
                      {c.id}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-snug">{c.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                        {c.match_criteria}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Baseline — only shown when defined */}
            {task.baseline != null && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Baseline (read-only)
                </p>
                <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
                  <div>workflow_id: {task.baseline.workflow_id}</div>
                  <div>workflow_version_id: {task.baseline.workflow_version_id}</div>
                </div>
              </div>
            )}

            {/*
              Inputs — only shown when the task declares workflow_input.
              Read-only so an operator can see what a run will be launched
              with before pressing Run. The expected answer is intentionally
              NEVER rendered here — it is structurally absent from this
              client module after the server-boundary split (see
              expected-outputs.server.generated.ts), not withheld by
              discipline.
            */}
            {task.workflow_input != null && Object.keys(task.workflow_input).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Inputs (read-only)
                </p>
                <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
                  {Object.entries(task.workflow_input).map(([key, value]) => (
                    <div key={key}>
                      {key}: {value}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Run trigger */}
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRun}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Running…
              </>
            ) : (
              "Run Benchmark"
            )}
          </Button>

          {runId && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Run started — ID: <span className="font-mono">{runId}</span>
            </span>
          )}

          {runError && (
            <span className="text-xs text-destructive">{runError}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function WorkflowBenchmarksPanel() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;

  if (!slug) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <p className="text-sm text-muted-foreground">
          {WORKFLOW_BENCHMARK_TASKS.length}{" "}
          {WORKFLOW_BENCHMARK_TASKS.length === 1 ? "task" : "tasks"} in the corpus.
          Click a task to expand its instructions and criteria, then press{" "}
          <strong>Run Benchmark</strong> to dispatch a scored run.
        </p>
      </div>

      <div className="space-y-3">
        {WORKFLOW_BENCHMARK_TASKS.map((task) => (
          <TaskCard key={task.slug} task={task} workspaceSlug={slug} />
        ))}
      </div>
    </div>
  );
}
