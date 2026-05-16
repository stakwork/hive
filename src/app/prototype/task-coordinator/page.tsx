"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Eye,
  GitBranch,
  Hash,
  Info,
  Layers,
  Link2,
  List,
  Loader2,
  Server,
  Shield,
  Ticket,
  Timer,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type DependencyResult = "SATISFIED" | "PENDING" | "PERMANENTLY_BLOCKED";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type WorkflowStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR" | "HALTED" | "FAILED";

interface MockTask {
  id: string;
  title: string;
  priority: Priority;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  workflowStatus: WorkflowStatus | null;
  dependsOnTaskIds: string[];
  dependencyResult: DependencyResult;
  featureTitle: string | null;
  phase: string | null;
  action: "DISPATCH" | "SKIP_PENDING" | "SKIP_BLOCKED" | "SKIP_CLAIMED";
  hasPod: boolean;
  podId: string | null;
}

interface MockWorkspace {
  id: string;
  slug: string;
  name: string;
  swarmEnabled: boolean;
  ticketSweepEnabled: boolean;
  recommendationSweepEnabled: boolean;
  totalPods: number;
  runningPods: number;
  usedPods: number;
  unusedPods: number;
  failedPods: number;
  pendingPods: number;
  queuedCount: number;
  slotsAvailable: number;
  candidateTasks: MockTask[];
  pendingRecommendations: number;
  staleTasks: number;
  orphanedPodRefs: number;
  processingNote: string | null;
}

interface MockSnapshot {
  timestamp: string;
  totalWorkspacesWithSweep: number;
  totalSlotsAvailable: number;
  totalQueued: number;
  totalStaleTasks: number;
  totalOrphanedPods: number;
  workspaces: MockWorkspace[];
}

const MOCK: MockSnapshot = {
  timestamp: "2026-05-12T13:11:00.000Z",
  totalWorkspacesWithSweep: 4,
  totalSlotsAvailable: 8,
  totalQueued: 14,
  totalStaleTasks: 2,
  totalOrphanedPods: 1,
  workspaces: [
    {
      id: "ws-1",
      slug: "alpha-squad",
      name: "Alpha Squad",
      swarmEnabled: true,
      ticketSweepEnabled: true,
      recommendationSweepEnabled: true,
      totalPods: 6,
      runningPods: 5,
      usedPods: 3,
      unusedPods: 2,
      failedPods: 1,
      pendingPods: 0,
      queuedCount: 5,
      slotsAvailable: 1,
      staleTasks: 1,
      orphanedPodRefs: 0,
      pendingRecommendations: 2,
      processingNote: null,
      candidateTasks: [
        {
          id: "task-101",
          title: "Refactor auth middleware to use token refresh strategy",
          priority: "CRITICAL",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: [],
          dependencyResult: "SATISFIED",
          featureTitle: "Security Hardening",
          phase: "Phase 1",
          action: "DISPATCH",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-102",
          title: "Add rate limiting to public API endpoints",
          priority: "HIGH",
          status: "TODO",
          workflowStatus: null,
          dependsOnTaskIds: ["task-101"],
          dependencyResult: "PENDING",
          featureTitle: "Security Hardening",
          phase: "Phase 1",
          action: "SKIP_PENDING",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-103",
          title: "Audit logging for admin actions",
          priority: "MEDIUM",
          status: "TODO",
          workflowStatus: null,
          dependsOnTaskIds: ["task-999"],
          dependencyResult: "PERMANENTLY_BLOCKED",
          featureTitle: "Security Hardening",
          phase: "Phase 2",
          action: "SKIP_BLOCKED",
          hasPod: false,
          podId: null,
        },
      ],
    },
    {
      id: "ws-2",
      slug: "beta-platform",
      name: "Beta Platform",
      swarmEnabled: true,
      ticketSweepEnabled: true,
      recommendationSweepEnabled: false,
      totalPods: 8,
      runningPods: 7,
      usedPods: 2,
      unusedPods: 5,
      failedPods: 0,
      pendingPods: 1,
      queuedCount: 6,
      slotsAvailable: 4,
      staleTasks: 0,
      orphanedPodRefs: 1,
      pendingRecommendations: 0,
      processingNote: null,
      candidateTasks: [
        {
          id: "task-201",
          title: "Implement websocket reconnection logic",
          priority: "HIGH",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: [],
          dependencyResult: "SATISFIED",
          featureTitle: "Real-time Sync",
          phase: "Sprint 3",
          action: "DISPATCH",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-202",
          title: "Add Pusher channel authentication",
          priority: "HIGH",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: [],
          dependencyResult: "SATISFIED",
          featureTitle: "Real-time Sync",
          phase: "Sprint 3",
          action: "DISPATCH",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-203",
          title: "Optimize payload size for broadcast events",
          priority: "MEDIUM",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: ["task-201", "task-202"],
          dependencyResult: "PENDING",
          featureTitle: "Real-time Sync",
          phase: "Sprint 3",
          action: "SKIP_PENDING",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-204",
          title: "Write integration tests for sync edge cases",
          priority: "LOW",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: ["task-201"],
          dependencyResult: "PENDING",
          featureTitle: "Real-time Sync",
          phase: "Sprint 4",
          action: "SKIP_PENDING",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-205",
          title: "Add dark mode to dashboard charts",
          priority: "LOW",
          status: "TODO",
          workflowStatus: null,
          dependsOnTaskIds: [],
          dependencyResult: "SATISFIED",
          featureTitle: null,
          phase: null,
          action: "DISPATCH",
          hasPod: false,
          podId: null,
        },
        {
          id: "task-206",
          title: "Migrate legacy CSV export to streaming",
          priority: "MEDIUM",
          status: "TODO",
          workflowStatus: "PENDING",
          dependsOnTaskIds: [],
          dependencyResult: "SATISFIED",
          featureTitle: "Data Export",
          phase: null,
          action: "DISPATCH",
          hasPod: false,
          podId: null,
        },
      ],
    },
    {
      id: "ws-3",
      slug: "gamma-ops",
      name: "Gamma Ops",
      swarmEnabled: true,
      ticketSweepEnabled: false,
      recommendationSweepEnabled: true,
      totalPods: 4,
      runningPods: 4,
      usedPods: 4,
      unusedPods: 0,
      failedPods: 0,
      pendingPods: 0,
      queuedCount: 2,
      slotsAvailable: 0,
      staleTasks: 1,
      orphanedPodRefs: 0,
      pendingRecommendations: 3,
      processingNote: "Insufficient available pods (need 2+), skipping",
      candidateTasks: [],
    },
    {
      id: "ws-4",
      slug: "delta-infra",
      name: "Delta Infra",
      swarmEnabled: false,
      ticketSweepEnabled: true,
      recommendationSweepEnabled: false,
      totalPods: 0,
      runningPods: 0,
      usedPods: 0,
      unusedPods: 0,
      failedPods: 0,
      pendingPods: 0,
      queuedCount: 1,
      slotsAvailable: 0,
      staleTasks: 0,
      orphanedPodRefs: 0,
      pendingRecommendations: 0,
      processingNote: "No pool configured, skipping",
      candidateTasks: [],
    },
  ],
};

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
  if (d === "SATISFIED") return <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">Satisfied</Badge>;
  if (d === "PENDING") return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 text-[10px]">Pending deps</Badge>;
  return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px]">Blocked forever</Badge>;
}

function actionBadge(a: MockTask["action"]) {
  if (a === "DISPATCH") return <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px] gap-1"><Zap className="h-2.5 w-2.5" />Dispatch</Badge>;
  if (a === "SKIP_PENDING") return <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30 text-[10px] gap-1"><Clock className="h-2.5 w-2.5" />Skip (deps)</Badge>;
  if (a === "SKIP_BLOCKED") return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px] gap-1"><Ban className="h-2.5 w-2.5" />Unassign</Badge>;
  return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-[10px] gap-1"><Shield className="h-2.5 w-2.5" />Already claimed</Badge>;
}

function PodBar({ ws }: { ws: MockWorkspace }) {
  const total = ws.totalPods || 1;
  return (
    <div className="flex gap-0.5 h-2 rounded overflow-hidden w-full">
      <div style={{ width: `${(ws.usedPods / total) * 100}%` }} className="bg-orange-500 rounded-l" title={`${ws.usedPods} used`} />
      <div style={{ width: `${(ws.unusedPods / total) * 100}%` }} className="bg-emerald-500" title={`${ws.unusedPods} available`} />
      <div style={{ width: `${(ws.pendingPods / total) * 100}%` }} className="bg-blue-400" title={`${ws.pendingPods} pending`} />
      <div style={{ width: `${(ws.failedPods / total) * 100}%` }} className="bg-red-500 rounded-r" title={`${ws.failedPods} failed`} />
    </div>
  );
}

// ─── Variation A: Dashboard Cards ─────────────────────────────────────────────

function VariationA() {
  const snap = MOCK;
  const [expandedWs, setExpandedWs] = useState<string | null>("ws-2");

  const dispatchCount = snap.workspaces.reduce((n, ws) =>
    n + ws.candidateTasks.filter(t => t.action === "DISPATCH").length, 0);
  const skipCount = snap.workspaces.reduce((n, ws) =>
    n + ws.candidateTasks.filter(t => t.action !== "DISPATCH").length, 0);

  return (
    <div className="space-y-6">
      {/* Top summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Workspaces Eligible", value: snap.totalWorkspacesWithSweep, icon: Users, color: "text-blue-500" },
          { label: "Slots Available Now", value: snap.totalSlotsAvailable, icon: Server, color: "text-emerald-500" },
          { label: "Tasks Queued", value: snap.totalQueued, icon: Ticket, color: "text-orange-500" },
          { label: "Would Dispatch", value: dispatchCount, icon: Zap, color: "text-purple-500" },
        ].map(s => (
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
              <span>{snap.totalStaleTasks} stale IN_PROGRESS task{snap.totalStaleTasks > 1 ? "s" : ""} would be halted</span>
            </div>
          )}
          {snap.totalOrphanedPods > 0 && (
            <div className="flex items-center gap-2 text-xs bg-orange-500/10 border border-orange-500/20 rounded-md px-3 py-2 text-orange-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{snap.totalOrphanedPods} orphaned pod ref{snap.totalOrphanedPods > 1 ? "s" : ""} would be cleared</span>
            </div>
          )}
        </div>
      )}

      {/* Per-workspace cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Per-Workspace Breakdown</h3>
        {snap.workspaces.map(ws => {
          const toDispatch = ws.candidateTasks.filter(t => t.action === "DISPATCH");
          const toSkip = ws.candidateTasks.filter(t => t.action !== "DISPATCH");
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
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <CardTitle className="text-sm font-semibold">{ws.name}</CardTitle>
                      <CardDescription className="text-xs">/w/{ws.slug}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ws.ticketSweepEnabled && <Badge variant="outline" className="text-[10px]">Ticket sweep</Badge>}
                    {ws.recommendationSweepEnabled && <Badge variant="outline" className="text-[10px]">Rec sweep</Badge>}
                    {ws.processingNote
                      ? <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-[10px]">Skipped</Badge>
                      : toDispatch.length > 0
                        ? <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px] gap-1"><Zap className="h-2.5 w-2.5" />{toDispatch.length} to dispatch</Badge>
                        : <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 text-[10px]">No action</Badge>
                    }
                  </div>
                </div>

                {/* Pod bar */}
                <div className="mt-2 space-y-1 ml-7">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Pods: {ws.runningPods}/{ws.totalPods} running · {ws.unusedPods} available · {ws.slotsAvailable} slots</span>
                    <span>{ws.queuedCount} queued</span>
                  </div>
                  <PodBar ws={ws} />
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-orange-500" />Used</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />Free</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-400" />Pending</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" />Failed</span>
                  </div>
                </div>

                {ws.processingNote && (
                  <div className="ml-7 mt-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
                    <Info className="h-3 w-3" />{ws.processingNote}
                  </div>
                )}
              </CardHeader>

              {isExpanded && ws.candidateTasks.length > 0 && (
                <CardContent className="pt-0">
                  <Separator className="mb-3" />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Candidate Tasks ({ws.candidateTasks.length})</p>
                    {ws.candidateTasks.map(task => (
                      <div key={task.id} className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 border text-xs ${task.action === "DISPATCH" ? "bg-blue-500/5 border-blue-500/20" : "bg-muted/30 border-border"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`text-[10px] ${priorityColor(task.priority)}`}>{task.priority}</Badge>
                            {depBadge(task.dependencyResult)}
                            {task.dependsOnTaskIds.length > 0 && (
                              <span className="flex items-center gap-1 text-muted-foreground"><Link2 className="h-2.5 w-2.5" />{task.dependsOnTaskIds.length} dep{task.dependsOnTaskIds.length > 1 ? "s" : ""}</span>
                            )}
                          </div>
                          <p className="font-medium text-foreground mt-1 leading-snug">{task.title}</p>
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
                  {ws.pendingRecommendations > 0 && ws.candidateTasks.filter(t => t.action === "DISPATCH").length === 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs bg-purple-500/10 border border-purple-500/20 rounded px-3 py-2 text-purple-400">
                      <Layers className="h-3.5 w-3.5" />
                      <span>No tickets dispatched — would fall back to {ws.pendingRecommendations} pending recommendations</span>
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

// ─── Variation B: Compact Table View ──────────────────────────────────────────

function VariationB() {
  const snap = MOCK;
  const [selected, setSelected] = useState<string | null>("ws-2");
  const selectedWs = snap.workspaces.find(w => w.id === selected) ?? null;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap gap-4 text-sm">
        {[
          { icon: Users, label: `${snap.totalWorkspacesWithSweep} eligible workspaces` },
          { icon: Server, label: `${snap.totalSlotsAvailable} open slots` },
          { icon: Ticket, label: `${snap.totalQueued} tasks queued` },
          { icon: Timer, label: `${snap.totalStaleTasks} stale tasks` },
          { icon: AlertTriangle, label: `${snap.totalOrphanedPods} orphaned pods` },
        ].map(s => (
          <span key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
            <s.icon className="h-3.5 w-3.5" />{s.label}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(snap.timestamp).toLocaleTimeString()}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Workspace list */}
        <div className="md:col-span-1 border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspaces</p>
          </div>
          <div className="divide-y">
            {snap.workspaces.map(ws => {
              const toDispatch = ws.candidateTasks.filter(t => t.action === "DISPATCH").length;
              return (
                <button
                  key={ws.id}
                  onClick={() => setSelected(ws.id)}
                  className={`w-full text-left px-3 py-3 hover:bg-muted/40 transition-colors ${selected === ws.id ? "bg-muted/60" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium truncate">{ws.name}</p>
                    {toDispatch > 0
                      ? <span className="shrink-0 flex items-center gap-1 text-[10px] text-blue-500"><Zap className="h-2.5 w-2.5" />{toDispatch}</span>
                      : ws.processingNote
                        ? <span className="text-[10px] text-muted-foreground">Skip</span>
                        : <span className="text-[10px] text-muted-foreground">—</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{ws.unusedPods} free pod{ws.unusedPods !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{ws.queuedCount} queued</span>
                  </div>
                  <div className="mt-1.5"><PodBar ws={ws} /></div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div className="md:col-span-2 border rounded-lg overflow-hidden">
          {selectedWs ? (
            <>
              <div className="bg-muted/40 px-4 py-3 border-b flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{selectedWs.name}</p>
                  <p className="text-xs text-muted-foreground">/w/{selectedWs.slug}</p>
                </div>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {selectedWs.ticketSweepEnabled && <Badge variant="outline" className="text-[10px]">Ticket</Badge>}
                  {selectedWs.recommendationSweepEnabled && <Badge variant="outline" className="text-[10px]">Recs</Badge>}
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Pod status */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pod Status</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: "Running", v: selectedWs.runningPods, cls: "text-foreground" },
                      { label: "Used", v: selectedWs.usedPods, cls: "text-orange-500" },
                      { label: "Free", v: selectedWs.unusedPods, cls: "text-emerald-500" },
                      { label: "Failed", v: selectedWs.failedPods, cls: "text-red-500" },
                    ].map(s => (
                      <div key={s.label} className="border rounded p-2">
                        <p className={`text-xl font-bold ${s.cls}`}>{s.v}</p>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{selectedWs.slotsAvailable} slots available (unusedPods − 1)</span>
                      <span>{selectedWs.queuedCount} tasks queued</span>
                    </div>
                    <PodBar ws={selectedWs} />
                  </div>
                </div>

                {selectedWs.processingNote ? (
                  <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-3 py-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-muted-foreground">{selectedWs.processingNote}</p>
                  </div>
                ) : selectedWs.candidateTasks.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Candidate Tasks</p>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 border-b">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Task</th>
                            <th className="text-left px-2 py-2 font-medium text-muted-foreground w-20">Priority</th>
                            <th className="text-left px-2 py-2 font-medium text-muted-foreground w-28">Deps</th>
                            <th className="text-left px-2 py-2 font-medium text-muted-foreground w-28">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedWs.candidateTasks.map(task => (
                            <tr key={task.id} className={task.action === "DISPATCH" ? "bg-blue-500/5" : ""}>
                              <td className="px-3 py-2">
                                <p className="font-medium text-foreground leading-snug">{task.title}</p>
                                {task.featureTitle && <p className="text-muted-foreground mt-0.5">{task.featureTitle}</p>}
                              </td>
                              <td className="px-2 py-2">
                                <Badge variant="outline" className={`text-[10px] ${priorityColor(task.priority)}`}>{task.priority}</Badge>
                              </td>
                              <td className="px-2 py-2">{depBadge(task.dependencyResult)}</td>
                              <td className="px-2 py-2">{actionBadge(task.action)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No candidate tasks in queue.</p>
                )}

                {selectedWs.staleTasks > 0 && (
                  <div className="flex items-center gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2 text-yellow-500">
                    <Timer className="h-3.5 w-3.5" />{selectedWs.staleTasks} stale task{selectedWs.staleTasks > 1 ? "s" : ""} would be halted before sweep
                  </div>
                )}
                {selectedWs.orphanedPodRefs > 0 && (
                  <div className="flex items-center gap-2 text-xs bg-orange-500/10 border border-orange-500/20 rounded px-3 py-2 text-orange-500">
                    <AlertTriangle className="h-3.5 w-3.5" />{selectedWs.orphanedPodRefs} orphaned pod ref{selectedWs.orphanedPodRefs > 1 ? "s" : ""} would be cleared
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm py-16">Select a workspace</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Variation C: Pipeline / Process-Flow View ────────────────────────────────

function PipelineStep({ step, active, last }: { step: number; active: boolean; last: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 ${active ? "border-blue-500 bg-blue-500/20 text-blue-500" : "border-border bg-muted text-muted-foreground"}`}>
          {step}
        </div>
        {!last && <div className="flex-1 w-px bg-border mt-1" style={{ minHeight: 16 }} />}
      </div>
    </div>
  );
}

function VariationC() {
  const snap = MOCK;

  const allToDispatch = snap.workspaces.flatMap(ws =>
    ws.candidateTasks.filter(t => t.action === "DISPATCH").map(t => ({ ...t, workspace: ws.name }))
  );
  const allPending = snap.workspaces.flatMap(ws =>
    ws.candidateTasks.filter(t => t.action === "SKIP_PENDING").map(t => ({ ...t, workspace: ws.name }))
  );
  const allBlocked = snap.workspaces.flatMap(ws =>
    ws.candidateTasks.filter(t => t.action === "SKIP_BLOCKED").map(t => ({ ...t, workspace: ws.name }))
  );
  const skippedWs = snap.workspaces.filter(ws => !!ws.processingNote);

  const steps = [
    {
      label: "Phase 1 — Stale Pod Cleanup",
      icon: Timer,
      color: "text-yellow-500",
      summary: `${snap.totalStaleTasks} stale IN_PROGRESS task${snap.totalStaleTasks !== 1 ? "s" : ""} halted · ${snap.totalOrphanedPods} orphaned pod ref${snap.totalOrphanedPods !== 1 ? "s" : ""} cleared`,
      details: snap.totalStaleTasks === 0 && snap.totalOrphanedPods === 0
        ? [{ id: "none", label: "Nothing to clean up", sub: "", cls: "" }]
        : [
          snap.totalStaleTasks > 0
            ? { id: "stale", label: `${snap.totalStaleTasks} stale task${snap.totalStaleTasks > 1 ? "s" : ""} → HALTED`, sub: "workflowStatus set to HALTED, pod released", cls: "text-yellow-500" }
            : null,
          snap.totalOrphanedPods > 0
            ? { id: "orphan", label: `${snap.totalOrphanedPods} orphaned pod ref${snap.totalOrphanedPods > 1 ? "s" : ""} → cleared`, sub: "podId, agentUrl, agentPassword nulled", cls: "text-orange-500" }
            : null,
        ].filter(Boolean) as { id: string; label: string; sub: string; cls: string }[],
    },
    {
      label: "Phase 2 — Workspace Discovery",
      icon: Users,
      color: "text-blue-500",
      summary: `${snap.totalWorkspacesWithSweep} workspaces with sweeps enabled found · ${skippedWs.length} skipped (no pool / insufficient pods)`,
      details: snap.workspaces.map(ws => ({
        id: ws.id,
        label: ws.name,
        sub: ws.processingNote ?? `${ws.slotsAvailable} slot${ws.slotsAvailable !== 1 ? "s" : ""} available · ${ws.queuedCount} queued`,
        cls: ws.processingNote ? "text-muted-foreground line-through" : "",
      })),
    },
    {
      label: "Phase 3 — Ticket Sweep (per workspace)",
      icon: Ticket,
      color: "text-purple-500",
      summary: `${allToDispatch.length} tasks would be dispatched · ${allPending.length} waiting on deps · ${allBlocked.length} unassigned (permanently blocked)`,
      details: [
        ...allToDispatch.map(t => ({ id: t.id, label: t.title, sub: `${t.workspace} · ${t.priority} · → DISPATCH via Stakwork`, cls: "text-blue-500" })),
        ...allPending.map(t => ({ id: t.id, label: t.title, sub: `${t.workspace} · deps not satisfied → skip this run`, cls: "text-yellow-500" })),
        ...allBlocked.map(t => ({ id: t.id, label: t.title, sub: `${t.workspace} · dep permanently cancelled → systemAssigneeType nulled`, cls: "text-red-500" })),
      ],
    },
    {
      label: "Phase 4 — Recommendation Sweep (fallback)",
      icon: Layers,
      color: "text-emerald-500",
      summary: `Runs only when 0 tickets were dispatched in a workspace. ${snap.workspaces.filter(ws => ws.recommendationSweepEnabled && ws.candidateTasks.filter(t => t.action === "DISPATCH").length === 0 && ws.pendingRecommendations > 0).length} workspace(s) eligible`,
      details: snap.workspaces
        .filter(ws => ws.recommendationSweepEnabled && ws.pendingRecommendations > 0)
        .map(ws => {
          const dispatched = ws.candidateTasks.filter(t => t.action === "DISPATCH").length;
          return {
            id: ws.id,
            label: ws.name,
            sub: dispatched > 0
              ? `Skipped — ${dispatched} ticket${dispatched > 1 ? "s" : ""} dispatched`
              : `${ws.pendingRecommendations} pending rec${ws.pendingRecommendations > 1 ? "s" : ""} → would auto-accept top recommendation`,
            cls: dispatched > 0 ? "text-muted-foreground" : "text-emerald-500",
          };
        }),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="flex flex-wrap gap-6 text-sm text-muted-foreground border-b pb-4">
        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Snapshot at {new Date(snap.timestamp).toLocaleTimeString()}</span>
        <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-emerald-500" />Read-only — no changes made</span>
        <span className="flex items-center gap-1.5 text-blue-500 font-medium"><Zap className="h-3.5 w-3.5" />{allToDispatch.length} tasks would be dispatched</span>
      </div>

      {/* Pipeline steps */}
      <div className="space-y-0">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${idx === 0 ? "border-blue-500 bg-blue-500/15" : "border-border bg-muted"}`}>
                <step.icon className={`h-4 w-4 ${step.color}`} />
              </div>
              {idx < steps.length - 1 && <div className="w-px bg-border flex-1 my-1" style={{ minHeight: 20 }} />}
            </div>
            <div className="pb-6 flex-1 min-w-0">
              <p className="text-sm font-semibold mb-0.5">{step.label}</p>
              <p className="text-xs text-muted-foreground mb-3">{step.summary}</p>
              {step.details.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  {step.details.map((d, di) => (
                    <div key={d.id + di} className={`flex items-start gap-2 px-3 py-2 text-xs ${di < step.details.length - 1 ? "border-b" : ""}`}>
                      <span className={`font-medium flex-1 truncate ${d.cls}`}>{d.label}</span>
                      {d.sub && <span className="text-muted-foreground text-right shrink-0 max-w-[50%] truncate">{d.sub}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaskCoordinatorPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Workflow className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold">Task Coordinator — Read-only Preview</h1>
            <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
              <Eye className="h-3 w-3" />Read-only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Snapshot of what the task coordinator would see and do <strong>right now</strong> — no changes are made.
            Refreshing this page re-reads current DB state.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 shrink-0">
          <Clock className="h-3 w-3" />
          {new Date(MOCK.timestamp).toLocaleString()}
        </div>
      </div>

      {/* Prototype label */}
      <div className="rounded-lg border border-dashed border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm text-blue-400">
        🧪 <strong>Prototype</strong> — using mock data. Choose a variation below, then we'll wire it to real DB reads.
      </div>

      <Tabs defaultValue="a">
        <TabsList className="mb-6">
          <TabsTrigger value="a" className="gap-1.5"><Layers className="h-3.5 w-3.5" />A — Dashboard Cards</TabsTrigger>
          <TabsTrigger value="b" className="gap-1.5"><List className="h-3.5 w-3.5" />B — Table + Detail</TabsTrigger>
          <TabsTrigger value="c" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" />C — Pipeline Flow</TabsTrigger>
        </TabsList>

        <TabsContent value="a">
          <div className="mb-4 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
            <strong>Variation A — Dashboard Cards:</strong> Top-level metrics with expandable per-workspace cards showing pod health bars and task-level decisions.
          </div>
          <VariationA />
        </TabsContent>

        <TabsContent value="b">
          <div className="mb-4 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
            <strong>Variation B — Table + Detail:</strong> Workspace sidebar list with a detail panel showing pod status grid and a compact task table with action columns.
          </div>
          <VariationB />
        </TabsContent>

        <TabsContent value="c">
          <div className="mb-4 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
            <strong>Variation C — Pipeline Flow:</strong> Step-by-step view mirroring the coordinator's 4-phase execution: cleanup → discovery → ticket sweep → recommendation fallback.
          </div>
          <VariationC />
        </TabsContent>
      </Tabs>
    </div>
  );
}
