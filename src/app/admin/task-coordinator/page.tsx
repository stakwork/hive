"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Info,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Server,
  Ticket,
  Timer,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import type {
  CoordinatorSnapshot,
  WorkspaceSnapshot,
  TaskSnapshot,
} from "@/app/api/admin/task-coordinator/snapshot/route";

// Re-export types for local use
type DependencyResult = TaskSnapshot["dependencyResult"];
type Priority = TaskSnapshot["priority"];
type TaskAction = TaskSnapshot["action"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityColor(p: Priority) {
  return {
    CRITICAL: "bg-red-500/15 text-red-500 border-red-500/30",
    HIGH: "bg-orange-500/15 text-orange-500 border-orange-500/30",
    MEDIUM: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
    LOW: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  }[p];
}

function depBadge(d: DependencyResult) {
  if (d === "SATISFIED")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">
        Satisfied
      </Badge>
    );
  if (d === "PENDING")
    return (
      <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 text-[10px]">
        Pending deps
      </Badge>
    );
  return (
    <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px]">
      Blocked forever
    </Badge>
  );
}

function actionBadge(a: TaskAction) {
  if (a === "DISPATCH")
    return (
      <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px] gap-1">
        <Zap className="h-2.5 w-2.5" />
        Dispatch
      </Badge>
    );
  if (a === "SKIP_PENDING")
    return (
      <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 text-[10px] gap-1">
        <Clock className="h-2.5 w-2.5" />
        Skip (deps)
      </Badge>
    );
  return (
    <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px] gap-1">
      <Ban className="h-2.5 w-2.5" />
      Unassign
    </Badge>
  );
}

function PodBar({ ws }: { ws: WorkspaceSnapshot }) {
  const total = ws.totalPods || 1;
  return (
    <div className="flex gap-0.5 h-2 rounded overflow-hidden w-full">
      <div
        style={{ width: `${(ws.usedPods / total) * 100}%` }}
        className="bg-orange-500 rounded-l"
        title={`${ws.usedPods} used`}
      />
      <div
        style={{ width: `${(ws.unusedPods / total) * 100}%` }}
        className="bg-emerald-500"
        title={`${ws.unusedPods} available`}
      />
      <div
        style={{ width: `${(ws.pendingPods / total) * 100}%` }}
        className="bg-blue-400"
        title={`${ws.pendingPods} pending`}
      />
      <div
        style={{ width: `${(ws.failedPods / total) * 100}%` }}
        className="bg-red-500 rounded-r"
        title={`${ws.failedPods} failed`}
      />
    </div>
  );
}

// ─── Variation A: Dashboard Cards ─────────────────────────────────────────────

function VariationA({ snap }: { snap: CoordinatorSnapshot }) {
  const [expandedWs, setExpandedWs] = useState<string | null>(null);

  const dispatchCount = snap.workspaces.reduce(
    (n, ws) => n + ws.candidateTasks.filter((t) => t.action === "DISPATCH").length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Workspaces Eligible",
            value: snap.totalWorkspacesWithSweep,
            icon: Users,
            color: "text-blue-500",
          },
          {
            label: "Slots Available Now",
            value: snap.totalSlotsAvailable,
            icon: Server,
            color: "text-emerald-500",
          },
          {
            label: "Tasks Queued",
            value: snap.totalQueued,
            icon: Ticket,
            color: "text-orange-500",
          },
          {
            label: "Would Dispatch",
            value: dispatchCount,
            icon: Zap,
            color: "text-purple-500",
          },
        ].map((s) => (
          <Card key={s.label} className="border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="text-3xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* System health strip */}
      {(snap.totalStaleTasks > 0 || snap.totalOrphanedPods > 0) && (
        <div className="flex gap-2 flex-wrap">
          {snap.totalStaleTasks > 0 && (
            <div className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-2 text-yellow-500">
              <Timer className="h-3.5 w-3.5" />
              <span>
                {snap.totalStaleTasks} stale IN_PROGRESS task
                {snap.totalStaleTasks > 1 ? "s" : ""} would be halted
              </span>
            </div>
          )}
          {snap.totalOrphanedPods > 0 && (
            <div className="flex items-center gap-2 text-xs bg-orange-500/10 border border-orange-500/20 rounded-md px-3 py-2 text-orange-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                {snap.totalOrphanedPods} orphaned pod ref
                {snap.totalOrphanedPods > 1 ? "s" : ""} would be cleared
              </span>
            </div>
          )}
        </div>
      )}

      {/* Per-workspace cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Per-Workspace Breakdown
        </h3>

        {snap.workspaces.length === 0 && (
          <Card className="border">
            <CardContent className="pt-6 pb-6 text-center text-muted-foreground text-sm">
              No workspaces with sweeps enabled.
            </CardContent>
          </Card>
        )}

        {snap.workspaces.map((ws) => {
          const toDispatch = ws.candidateTasks.filter((t) => t.action === "DISPATCH");
          const isExpanded = expandedWs === ws.id;
          const canProcess = !ws.processingNote && ws.slotsAvailable > 0;

          return (
            <Card key={ws.id} className={`border ${!canProcess ? "opacity-60" : ""}`}>
              <CardHeader
                className="pb-3 cursor-pointer select-none"
                onClick={() => setExpandedWs(isExpanded ? null : ws.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <CardTitle className="text-sm font-semibold">{ws.name}</CardTitle>
                      <CardDescription className="text-xs">/w/{ws.slug}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ws.ticketSweepEnabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Ticket sweep
                      </Badge>
                    )}
                    {ws.recommendationSweepEnabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Rec sweep
                      </Badge>
                    )}
                    {ws.processingNote ? (
                      <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-[10px]">
                        Skipped
                      </Badge>
                    ) : toDispatch.length > 0 ? (
                      <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px] gap-1">
                        <Zap className="h-2.5 w-2.5" />
                        {toDispatch.length} to dispatch
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-[10px]">
                        No action
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Pod bar */}
                <div className="mt-2 space-y-1 ml-7">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      Pods: {ws.runningPods}/{ws.totalPods} running · {ws.unusedPods} available
                      · {ws.slotsAvailable} slots
                    </span>
                    <span>{ws.queuedCount} queued</span>
                  </div>
                  <PodBar ws={ws} />
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />
                      Used
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
                      Free
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-blue-400" />
                      Pending
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-sm bg-red-500" />
                      Failed
                    </span>
                  </div>
                </div>

                {ws.processingNote && (
                  <div className="ml-7 mt-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
                    <Info className="h-3 w-3" />
                    {ws.processingNote}
                  </div>
                )}
              </CardHeader>

              {isExpanded && ws.candidateTasks.length > 0 && (
                <CardContent className="pt-0">
                  <Separator className="mb-3" />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Candidate Tasks ({ws.candidateTasks.length})
                    </p>
                    {ws.candidateTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 border text-xs ${
                          task.action === "DISPATCH"
                            ? "bg-blue-500/5 border-blue-500/20"
                            : "bg-muted/30 border-border"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${priorityColor(task.priority)}`}
                            >
                              {task.priority}
                            </Badge>
                            {depBadge(task.dependencyResult)}
                            {task.dependsOnTaskIds.length > 0 && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Link2 className="h-2.5 w-2.5" />
                                {task.dependsOnTaskIds.length} dep
                                {task.dependsOnTaskIds.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-foreground mt-1 leading-snug">
                            {task.title}
                          </p>
                          {(task.featureTitle || task.phase) && (
                            <p className="text-muted-foreground mt-0.5">
                              {task.featureTitle && <span>{task.featureTitle}</span>}
                              {task.featureTitle && task.phase && <span> · </span>}
                              {task.phase && <span>{task.phase}</span>}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">{actionBadge(task.action)}</div>
                      </div>
                    ))}
                  </div>
                  {ws.pendingRecommendations > 0 &&
                    ws.candidateTasks.filter((t) => t.action === "DISPATCH").length === 0 && (
                      <div className="mt-3 flex items-center gap-2 text-xs bg-purple-500/10 border border-purple-500/20 rounded px-3 py-2 text-purple-400">
                        <Layers className="h-3.5 w-3.5" />
                        <span>
                          No tickets dispatched — would fall back to {ws.pendingRecommendations}{" "}
                          pending recommendations
                        </span>
                      </div>
                    )}
                </CardContent>
              )}

              {isExpanded && ws.candidateTasks.length === 0 && !ws.processingNote && (
                <CardContent className="pt-0">
                  <Separator className="mb-3" />
                  <p className="text-xs text-muted-foreground">No candidate tasks in queue.</p>
                  {ws.pendingRecommendations > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs bg-purple-500/10 border border-purple-500/20 rounded px-3 py-2 text-purple-400">
                      <Layers className="h-3.5 w-3.5" />
                      <span>
                        {ws.pendingRecommendations} pending recommendation
                        {ws.pendingRecommendations > 1 ? "s" : ""} available for fallback
                      </span>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaskCoordinatorPage() {
  const [snapshot, setSnapshot] = useState<CoordinatorSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/task-coordinator/snapshot");
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data: CoordinatorSnapshot = await res.json();
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load snapshot");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot(false);
  }, [fetchSnapshot]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Workflow className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold">Task Coordinator — Live Snapshot</h1>
            <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
              <Eye className="h-3 w-3" />
              Read-only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Snapshot of what the task coordinator would see and do{" "}
            <strong>right now</strong> — no changes are made.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {snapshot && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <Clock className="h-3 w-3" />
              {new Date(snapshot.timestamp).toLocaleString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSnapshot(true)}
            disabled={isLoading || isRefreshing}
            className="gap-1.5"
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="flex items-center gap-2 text-sm bg-red-500/10 border border-red-500/20 rounded-md px-4 py-3 text-red-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Live data */}
      {!isLoading && snapshot && <VariationA snap={snapshot} />}
    </div>
  );
}
