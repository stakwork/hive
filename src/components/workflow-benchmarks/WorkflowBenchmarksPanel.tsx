"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WORKFLOW_BENCHMARK_TASKS, type WorkflowBenchmarkTask } from "@/lib/workflow-benchmark-tasks";

// ─── Section grouping ─────────────────────────────────────────────────────────

/**
 * Display names for sections whose directory name isn't just
 * capitalized ("llm" → "LLM"). Every other section falls back to a plain
 * capitalization of the directory name — the taxonomy is open, so a new
 * directory needs no entry here to render.
 */
const SECTION_LABELS: Record<string, string> = { llm: "LLM" };

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
}

interface TaskSection {
  section: string;
  tasks: WorkflowBenchmarkTask[];
}

/**
 * The corpus grouped by its `section` field (the grouping directory each
 * task.json sits under), sections sorted alphabetically. Static — the corpus
 * is a build-time import, so this is computed once at module level.
 */
const TASK_SECTIONS: TaskSection[] = (() => {
  const bySection = new Map<string, WorkflowBenchmarkTask[]>();
  for (const task of WORKFLOW_BENCHMARK_TASKS) {
    const list = bySection.get(task.section) ?? [];
    list.push(task);
    bySection.set(task.section, list);
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, tasks]) => ({ section, tasks }));
})();

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
  // Where to execute: Stakwork (the default, unchanged) or the workspace
  // swarm's strut lab. Only sent when strut is chosen, so the default request
  // is byte-identical to before.
  const [runner, setRunner] = useState<"stakwork" | "strut">("stakwork");

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
          body: JSON.stringify({
            taskSlug: task.slug,
            ...(runner === "strut" ? { runner } : {}),
          }),
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
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={runner}
            // Radix clears the value when the active item is clicked again;
            // keep the last choice instead of leaving the toggle blank.
            onValueChange={(v) => { if (v === "strut" || v === "stakwork") setRunner(v); }}
            disabled={isRunning}
            aria-label="Benchmark runner"
            data-testid={`wf-runner-toggle-${task.slug}`}
          >
            <ToggleGroupItem value="stakwork" className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary" aria-label="Run on Stakwork">
              Stakwork
            </ToggleGroupItem>
            <ToggleGroupItem value="strut" className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary" aria-label="Run on strut">
              strut
            </ToggleGroupItem>
          </ToggleGroup>
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

  const [selectedSection, setSelectedSection] = useState<string>(
    TASK_SECTIONS[0]?.section ?? "",
  );

  if (!slug) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading workspace…
      </div>
    );
  }

  const currentSection = TASK_SECTIONS.find((s) => s.section === selectedSection);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border">
      {/* Left column — section list (mirrors LegalBenchmarksPanel's practice-area rail) */}
      <div className="w-60 shrink-0 border-r flex flex-col">
        <div className="px-3 py-3 border-b flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Sections
          </p>
          <Badge variant="secondary" className="text-xs shrink-0">
            {WORKFLOW_BENCHMARK_TASKS.length}
          </Badge>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-0.5">
            {TASK_SECTIONS.map(({ section, tasks }) => (
              <button
                key={section}
                onClick={() => setSelectedSection(section)}
                className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
                  selectedSection === section
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <span className="truncate">{sectionLabel(section)}</span>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {tasks.length}
                </Badge>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right panel — selected section's tasks */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b flex items-baseline gap-2">
          <p className="text-sm font-medium">
            {currentSection ? sectionLabel(currentSection.section) : "No section"}
          </p>
          <p className="text-xs text-muted-foreground">
            {currentSection?.tasks.length ?? 0}{" "}
            {currentSection?.tasks.length === 1 ? "task" : "tasks"}
          </p>
          {currentSection && (
            <p className="ml-auto font-mono text-xs text-muted-foreground">
              tasks/{currentSection.section}/
            </p>
          )}
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-3 max-w-3xl">
            {currentSection?.tasks.map((task) => (
              <TaskCard key={task.slug} task={task} workspaceSlug={slug} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
