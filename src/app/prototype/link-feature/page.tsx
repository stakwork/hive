"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link2, Search, Pencil, Trash2, Plus, Check, Clock, X } from "lucide-react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const WORKSPACES = [
  { id: "ws-1", name: "Frontend Platform" },
  { id: "ws-2", name: "Backend Services" },
  { id: "ws-3", name: "Mobile Apps" },
  { id: "ws-4", name: "Data & Analytics" },
];

function daysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString(); }
function hoursAgo(h: number) { return new Date(Date.now() - h * 3600000).toISOString(); }
function minsAgo(m: number) { return new Date(Date.now() - m * 60000).toISOString(); }

const ALL_FEATURES = [
  { id: "f-1",  name: "Dark Mode Toggle",               workspaceId: "ws-1", workspaceName: "Frontend Platform",  status: "IN_PROGRESS", updatedAt: hoursAgo(2)  },
  { id: "f-2",  name: "Onboarding Flow Redesign",        workspaceId: "ws-1", workspaceName: "Frontend Platform",  status: "PLANNED",     updatedAt: daysAgo(1)   },
  { id: "f-3",  name: "Component Library v2",            workspaceId: "ws-1", workspaceName: "Frontend Platform",  status: "BACKLOG",     updatedAt: daysAgo(4)   },
  { id: "f-4",  name: "Authentication Microservice",     workspaceId: "ws-2", workspaceName: "Backend Services",   status: "IN_PROGRESS", updatedAt: minsAgo(45)  },
  { id: "f-5",  name: "Rate Limiting & Throttling",      workspaceId: "ws-2", workspaceName: "Backend Services",   status: "COMPLETED",   updatedAt: daysAgo(2)   },
  { id: "f-6",  name: "GraphQL Federation",              workspaceId: "ws-2", workspaceName: "Backend Services",   status: "PLANNED",     updatedAt: daysAgo(6)   },
  { id: "f-7",  name: "Event-Driven Architecture",       workspaceId: "ws-2", workspaceName: "Backend Services",   status: "BACKLOG",     updatedAt: daysAgo(10)  },
  { id: "f-8",  name: "iOS Push Notifications",          workspaceId: "ws-3", workspaceName: "Mobile Apps",        status: "IN_PROGRESS", updatedAt: hoursAgo(5)  },
  { id: "f-9",  name: "Offline Mode Support",            workspaceId: "ws-3", workspaceName: "Mobile Apps",        status: "PLANNED",     updatedAt: daysAgo(3)   },
  { id: "f-10", name: "Biometric Authentication",        workspaceId: "ws-3", workspaceName: "Mobile Apps",        status: "BACKLOG",     updatedAt: daysAgo(7)   },
  { id: "f-11", name: "Real-time Analytics Dashboard",   workspaceId: "ws-4", workspaceName: "Data & Analytics",   status: "IN_PROGRESS", updatedAt: hoursAgo(1)  },
  { id: "f-12", name: "Data Pipeline Orchestration",     workspaceId: "ws-4", workspaceName: "Data & Analytics",   status: "PLANNED",     updatedAt: daysAgo(2)   },
  { id: "f-13", name: "ML Feature Store",                workspaceId: "ws-4", workspaceName: "Data & Analytics",   status: "BACKLOG",     updatedAt: daysAgo(14)  },
  { id: "f-14", name: "A/B Testing Framework",           workspaceId: "ws-4", workspaceName: "Data & Analytics",   status: "COMPLETED",   updatedAt: daysAgo(5)   },
  { id: "f-15", name: "User Segmentation Engine",        workspaceId: "ws-4", workspaceName: "Data & Analytics",   status: "IN_PROGRESS", updatedAt: minsAgo(20)  },
];

const MILESTONES_INITIAL = [
  { id: "m-1", name: "Q1 Foundation", sequence: 1, status: "COMPLETED"   as const, dueDate: "2026-03-31", linkedFeatureId: null as string | null },
  { id: "m-2", name: "Q2 Growth",     sequence: 2, status: "IN_PROGRESS" as const, dueDate: "2026-06-30", linkedFeatureId: null as string | null },
  { id: "m-3", name: "Q3 Scale",      sequence: 3, status: "NOT_STARTED" as const, dueDate: "2026-09-30", linkedFeatureId: null as string | null },
  { id: "m-4", name: "Q4 Polish",     sequence: 4, status: "NOT_STARTED" as const, dueDate: "2026-12-31", linkedFeatureId: null as string | null },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function MilestoneStatusBadge({ status }: { status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" }) {
  const map = {
    NOT_STARTED: { label: "Not Started", cls: "bg-muted text-muted-foreground" },
    IN_PROGRESS: { label: "In Progress", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    COMPLETED:   { label: "Completed",   cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  };
  const { label, cls } = map[status];
  return <Badge className={`${cls} border-0 text-xs font-medium`}>{label}</Badge>;
}

function FeatureStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    BACKLOG:     "bg-muted text-muted-foreground",
    PLANNED:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    COMPLETED:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    CANCELLED:   "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const labels: Record<string, string> = {
    BACKLOG: "Backlog", PLANNED: "Planned", IN_PROGRESS: "In Progress",
    COMPLETED: "Completed", CANCELLED: "Cancelled",
  };
  return (
    <Badge className={`${cls[status] ?? "bg-muted text-muted-foreground"} border-0 text-xs font-medium`}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ─── Link Feature Modal ───────────────────────────────────────────────────────

interface LinkFeatureModalProps {
  open: boolean;
  milestoneName: string;
  currentFeatureId: string | null;
  onConfirm: (featureId: string | null) => void;
  onClose: () => void;
}

function LinkFeatureModal({ open, milestoneName, currentFeatureId, onConfirm, onClose }: LinkFeatureModalProps) {
  const [workspace, setWorkspace] = useState<string>("all");
  const [query, setQuery]         = useState("");
  const [selected, setSelected]   = useState<string | null>(currentFeatureId);

  // Reset state each time the modal opens
  const handleOpenChange = (v: boolean) => {
    if (!v) { onClose(); return; }
    setWorkspace("all");
    setQuery("");
    setSelected(currentFeatureId);
  };

  const results = ALL_FEATURES
    .filter(f => {
      const matchWs = workspace === "all" || f.workspaceId === workspace;
      const matchQ  = query.length < 3 || f.name.toLowerCase().includes(query.toLowerCase());
      return matchWs && matchQ;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const selectedFeature = selected ? ALL_FEATURES.find(f => f.id === selected) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl flex flex-col gap-0 p-0 overflow-hidden max-h-[90vh]">

        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-blue-500" />
            Link Feature
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Linking to milestone:{" "}
            <span className="font-medium text-foreground">{milestoneName}</span>
          </p>
        </DialogHeader>

        {/* ── Filters ── */}
        <div className="flex gap-2 px-5 py-3 border-b shrink-0">
          <Select value={workspace} onValueChange={setWorkspace}>
            <SelectTrigger className="w-48 h-9 text-sm">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              {WORKSPACES.map(ws => (
                <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              className="pl-9 h-9 pr-8"
              placeholder="Search features… (min 3 characters)"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Character-count hint ── */}
        {query.length > 0 && query.length < 3 && (
          <div className="flex items-center gap-1.5 px-5 py-2 text-xs text-muted-foreground border-b shrink-0">
            <Clock className="h-3.5 w-3.5" />
            Type {3 - query.length} more character{3 - query.length !== 1 ? "s" : ""} to search
          </div>
        )}

        {/* ── Results list ── */}
        <div className="flex-1 overflow-y-auto border-b min-h-0">
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Search className="h-9 w-9 opacity-20" />
              <p className="text-sm">No features found</p>
            </div>
          ) : (
            <div className="divide-y">
              {results.map(f => {
                const isSelected = selected === f.id;
                return (
                  <button
                    key={f.id}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent ${
                      isSelected ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500" : ""
                    }`}
                    onClick={() => setSelected(isSelected ? null : f.id)}
                  >
                    {/* Checkbox */}
                    <div
                      className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-blue-500 border-blue-500"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>

                    {/* Feature info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{f.name}</span>
                        <FeatureStatusBadge status={f.status} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground">{f.workspaceName}</span>
                        <span className="text-xs text-muted-foreground/50">·</span>
                        <span className="text-xs text-muted-foreground">{relativeTime(f.updatedAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Selected feature preview ── */}
        {selectedFeature && (
          <div className="flex items-center gap-2 mx-5 my-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-sm shrink-0">
            <Link2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
            <span className="text-blue-700 dark:text-blue-300 font-medium truncate flex-1">
              {selectedFeature.name}
            </span>
            <span className="text-blue-500/70 text-xs shrink-0">{selectedFeature.workspaceName}</span>
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="px-5 pb-5 pt-1 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={!selected}
            className="gap-2"
          >
            <Link2 className="h-4 w-4" />
            Link Feature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Milestones Table ─────────────────────────────────────────────────────────

type MilestoneRow = typeof MILESTONES_INITIAL[number];

function MilestonesTable() {
  const [milestones, setMilestones] = useState<MilestoneRow[]>(
    MILESTONES_INITIAL.map(m => ({ ...m }))
  );
  const [linkTarget, setLinkTarget] = useState<MilestoneRow | null>(null);

  const handleLink = (featureId: string | null) => {
    if (!linkTarget) return;
    setMilestones(prev =>
      prev.map(m => m.id === linkTarget.id ? { ...m, linkedFeatureId: featureId } : m)
    );
    setLinkTarget(null);
  };

  const handleUnlink = (milestoneId: string) => {
    setMilestones(prev =>
      prev.map(m => m.id === milestoneId ? { ...m, linkedFeatureId: null } : m)
    );
  };

  return (
    <>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-xs">Seq</TableHead>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Due Date</TableHead>
              <TableHead className="text-xs">Linked Feature</TableHead>
              <TableHead className="w-28 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {milestones.map(m => {
              const linked = m.linkedFeatureId
                ? ALL_FEATURES.find(f => f.id === m.linkedFeatureId)
                : null;

              return (
                <TableRow key={m.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {m.sequence}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{m.name}</TableCell>
                  <TableCell>
                    <MilestoneStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.dueDate}</TableCell>
                  <TableCell>
                    {linked ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Link2 className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="text-sm text-blue-600 dark:text-blue-400 font-medium truncate">
                            {linked.name}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            · {linked.workspaceName}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleUnlink(m.id)}
                          title="Unlink feature"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit milestone"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-blue-600"
                        title="Link feature"
                        onClick={() => setLinkTarget(m)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete milestone"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" className="mt-2">
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Milestone
      </Button>

      {linkTarget && (
        <LinkFeatureModal
          open={!!linkTarget}
          milestoneName={linkTarget.name}
          currentFeatureId={linkTarget.linkedFeatureId}
          onConfirm={handleLink}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LinkFeaturePrototype() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Page header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
            <span>Prototype</span>
            <span>·</span>
            <span>Milestone → Link Feature</span>
          </div>
          <h1 className="text-2xl font-bold">Link Feature to Milestone</h1>
          <p className="text-muted-foreground text-sm">
            Click the <Link2 className="h-3.5 w-3.5 inline mx-0.5 text-blue-500" /> icon on any
            milestone row to open the feature search modal.
          </p>
        </div>

        {/* Simulated initiative context */}
        <div className="rounded-xl border bg-muted/10 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3 border-b bg-background">
            <div className="h-5 w-2 rounded-full bg-blue-500/80" />
            <span className="text-sm font-semibold">Q2 2026 Launch Initiative</span>
            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs">
              Active
            </Badge>
          </div>
          <div className="p-4">
            <MilestonesTable />
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center pb-4">
          Prototype only — mock data, no API calls.
        </p>
      </div>
    </div>
  );
}
