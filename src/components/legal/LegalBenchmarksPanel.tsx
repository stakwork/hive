"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { LegalBenchmarkResults } from "@/components/legal/LegalBenchmarkResults";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";
import { WORK_TYPE_STYLES } from "@/lib/harvey-lab-tasks";
import { TaskDetailsModal } from "@/components/legal/TaskDetailsModal";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    if (!slug) return;

    const fetchTasks = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/workspaces/${slug}/legal/benchmarks/tasks`);
        if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
        const data: BenchmarksResponse = await res.json();
        setPracticeAreas(data.practice_areas);
        if (data.practice_areas.length > 0) {
          setSelectedArea(data.practice_areas[0].slug);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load benchmarks");
      } finally {
        setIsLoading(false);
      }
    };

    fetchTasks();
  }, [slug]);

  const handleSelectTask = async (task: HarveyTask) => {
    const res = await fetch(`/api/workspaces/${slug}/legal/benchmarks/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskSlug: task.slug, taskTitle: task.title }),
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

        {/* Right panel — search + task grid */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
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
