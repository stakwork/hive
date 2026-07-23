"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Search, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/hooks/useWorkspace";
import { LegalBenchmarkResults } from "@/components/legal/LegalBenchmarkResults";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";
import { WORK_TYPE_STYLES } from "@/lib/harvey-lab-tasks";
import { TaskDetailsModal } from "@/components/legal/TaskDetailsModal";
import { cn } from "@/lib/utils";
import {
  getModelValue,
  DEFAULT_BENCHMARK_MODEL,
  DEFAULT_JUDGE_MODEL,
  type LlmModelOption,
} from "@/lib/ai/models";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PracticeArea {
  slug: string;
  label: string;
  task_count: number;
  tasks: HarveyTask[];
}

interface BenchmarksResponse {
  practice_areas: PracticeArea[];
  total: number;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TaskCardSkeleton() {
  return (
    <Card className="p-4">
      <CardContent className="p-0 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </CardContent>
    </Card>
  );
}

// ─── Task Card ───────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: HarveyTask;
  onSelect: (task: HarveyTask) => void;
  onViewDetails: (task: HarveyTask) => void;
  isRunning: boolean;
}

function TaskCard({ task, onSelect, onViewDetails, isRunning }: TaskCardProps) {
  const visibleTags = task.tags.slice(0, 3);
  const overflowCount = task.tags.length - 3;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        <p className="font-semibold text-sm leading-snug">{task.title}</p>

        <div className="flex flex-wrap gap-1.5 items-center">
          <Badge
            variant="outline"
            className={`text-xs capitalize border-0 ${WORK_TYPE_STYLES[task.work_type]}`}
          >
            {task.work_type}
          </Badge>

          {visibleTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-xs text-muted-foreground"
            >
              {tag}
            </Badge>
          ))}

          {overflowCount > 0 && (
            <Badge variant="secondary" className="text-xs text-muted-foreground">
              +{overflowCount} more
            </Badge>
          )}
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onViewDetails(task)}>
            Details
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelect(task)}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Running…
              </>
            ) : (
              "Select Task"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip provider prefix for display, e.g. "anthropic/claude-sonnet-5" → "claude-sonnet-5" */
function displayModelName(value: string): string {
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LegalBenchmarksPanel({ className }: { className?: string }) {
  const { slug, isSuperAdmin } = useWorkspace();

  const [practiceAreas, setPracticeAreas] = useState<PracticeArea[]>([]);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runningTaskSlug, setRunningTaskSlug] = useState<string | null>(null);
  const [detailsTask, setDetailsTask] = useState<HarveyTask | null>(null);

  // ─── Model selection ───────────────────────────────────────────────────────
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_BENCHMARK_MODEL);
  const [selectedJudgeModel, setSelectedJudgeModel] = useState<string>(DEFAULT_JUDGE_MODEL);

  // Fetch LLM models and tasks on mount
  useEffect(() => {
    if (!slug) return;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [tasksRes, modelsRes] = await Promise.all([
          fetch(`/api/workspaces/${slug}/legal/benchmarks/tasks`),
          fetch("/api/llm-models"),
        ]);

        if (!tasksRes.ok) throw new Error(`Failed to fetch tasks: ${tasksRes.status}`);
        const tasksData: BenchmarksResponse = await tasksRes.json();
        setPracticeAreas(tasksData.practice_areas);
        if (tasksData.practice_areas.length > 0) {
          setSelectedArea(tasksData.practice_areas[0].slug);
        }

        if (modelsRes.ok) {
          const data = await modelsRes.json();
          const modelsData: LlmModelOption[] = data.models ?? [];
          // Filter to Anthropic-only (Harvey runner is Anthropic-only)
          const anthropicModels = modelsData.filter(
            (m) => m.provider === "ANTHROPIC"
          );
          setLlmModels(anthropicModels);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load benchmarks");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [slug]);

  const handleSelectTask = async (task: HarveyTask) => {
    const res = await fetch(`/api/workspaces/${slug}/legal/benchmarks/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskSlug: task.slug,
        taskTitle: task.title,
        model: selectedModel,
        judgeModel: selectedJudgeModel,
      }),
    });

    if (!res.ok) {
      const { error: errMsg } = await res.json();
      toast.error(errMsg ?? "Failed to start run");
      return;
    }

    const { run_id } = await res.json();
    setActiveRunId(run_id);
    setRunningTaskSlug(task.slug);
  };

  const handleReset = () => {
    setActiveRunId(null);
    setRunningTaskSlug(null);
  };

  const currentArea = practiceAreas.find((pa) => pa.slug === selectedArea);

  const filteredTasks =
    currentArea?.tasks.filter((task) =>
      task.title.toLowerCase().includes(search.toLowerCase())
    ) ?? [];

  // Build picker options — fall back to hardcoded defaults if catalog is empty
  const pickerOptions: LlmModelOption[] =
    llmModels.length > 0
      ? llmModels
      : [
          {
            id: DEFAULT_BENCHMARK_MODEL,
            name: displayModelName(DEFAULT_BENCHMARK_MODEL),
            provider: "ANTHROPIC",
            providerLabel: null,
            isPlanDefault: false,
            isTaskDefault: false,
          },
          {
            id: DEFAULT_JUDGE_MODEL,
            name: displayModelName(DEFAULT_JUDGE_MODEL),
            provider: "ANTHROPIC",
            providerLabel: null,
            isPlanDefault: false,
            isTaskDefault: false,
          },
        ];

  return (
    <div className={cn("flex flex-col flex-1 overflow-hidden min-h-0", className)}>
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left column — practice area list */}
        <div className="w-60 shrink-0 border-r flex flex-col">
          <div className="px-3 py-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Practice Areas
            </p>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-0.5">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-md mb-1" />
                  ))
                : practiceAreas.map((area) => (
                    <button
                      key={area.slug}
                      onClick={() => {
                        setSelectedArea(area.slug);
                        setSearch("");
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
                        selectedArea === area.slug
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{area.label}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {area.task_count}
                      </Badge>
                    </button>
                  ))}
            </div>
          </ScrollArea>
        </div>

        {/* Right panel — model selectors + search + task grid */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Model selectors row */}
          <div className="px-4 py-2.5 border-b flex flex-wrap items-center gap-3">
            {/* Execution Model */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                Execution Model
              </span>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger
                  className="h-7 text-xs px-2 w-auto min-w-[160px] max-w-[220px]"
                  data-testid="execution-model-select"
                >
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {pickerOptions.map((m) => {
                    const val = getModelValue(m);
                    return (
                      <SelectItem key={m.id} value={val} className="text-xs">
                        {m.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Judge Model */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                Judge Model
              </span>
              <Select value={selectedJudgeModel} onValueChange={setSelectedJudgeModel}>
                <SelectTrigger
                  className="h-7 text-xs px-2 w-auto min-w-[160px] max-w-[220px]"
                  data-testid="judge-model-select"
                >
                  <SelectValue placeholder="Select judge" />
                </SelectTrigger>
                <SelectContent>
                  {pickerOptions.map((m) => {
                    const val = getModelValue(m);
                    return (
                      <SelectItem key={m.id} value={val} className="text-xs">
                        {m.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Judge model is captured and stored but does not yet influence
                  scoring until Stakwork workflow 57179 is wired to read{" "}
                  <code>{"{{vars.judge_model}}"}</code> in its scoring step.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Search */}
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0 p-4">
            {error ? (
              <div className="flex items-center justify-center h-40 text-sm text-destructive">
                {error}
              </div>
            ) : isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <TaskCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground">
                <p>No tasks match your search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.slug}
                    task={task}
                    onSelect={handleSelectTask}
                    onViewDetails={setDetailsTask}
                    isRunning={task.slug === runningTaskSlug}
                  />
                ))}
              </div>
            )}

            {/* Inline results panel — rendered below the task grid */}
            {activeRunId && (
              <LegalBenchmarkResults runId={activeRunId} onReset={handleReset} isSuperAdmin={isSuperAdmin} />
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Task details modal */}
      {detailsTask && (
        <TaskDetailsModal
          open={true}
          onOpenChange={(o) => { if (!o) setDetailsTask(null); }}
          task={detailsTask}
          slug={slug!}
          onRunTask={() => handleSelectTask(detailsTask)}
        />
      )}
    </div>
  );
}
