"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Search, ChevronUp, ChevronDown, Plus, RefreshCw, Play, Square } from "lucide-react";
import CreateSwarmDialog from "./CreateSwarmDialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/utils/format";
import type {
  SwarmStorageHistoryPoint,
  SwarmStorageHistoryResponse,
  SwarmStorageInstancePayload,
} from "@/app/api/admin/swarms/storage/route";

interface Ec2Instance {
  instanceId: string;
  name: string;
  state: string;
  instanceType: string;
  launchTime: string | null;
  tags: { key: string; value: string }[];
  publicIp: string | null;
  privateIp: string | null;
  hiveWorkspace: { name: string; slug: string } | null;
}

type SortField = "name" | "launchTime";
type SortDirection = "asc" | "desc";

type PendingAction = {
  instance: Ec2Instance;
  action: "start" | "stop";
};

function StateBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    running: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    stopped: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    stopping: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    "shutting-down": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    terminated: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return <Badge className={variants[state] ?? "bg-gray-100 text-gray-700"}>{state}</Badge>;
}

const TRANSITIONAL_STATES = new Set(["pending", "stopping", "shutting-down", "rebooting"]);
const MAX_SERVICE_NAME_DISPLAY = 32;
const SPARKLINE_WIDTH = 72;
const SPARKLINE_HEIGHT = 24;
const SERVICES_PREVIEW_LIMIT = 3;

function getUserAssignedName(tags: { key: string; value: string }[]): string | null {
  return tags.find((t) => t.key === "UserAssignedName")?.value ?? null;
}

function truncateServiceName(name: string): string {
  return name.length > MAX_SERVICE_NAME_DISPLAY ? `${name.slice(0, MAX_SERVICE_NAME_DISPLAY)}…` : name;
}

function usagePercent(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total <= 0 || !Number.isFinite(used) || !Number.isFinite(total)) {
    return null;
  }
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function formatCollectedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function snapshotStatusClass(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === "OK") {
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (normalized === "PARTIAL") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  }
  if (normalized === "UNREACHABLE" || normalized === "FAILED" || normalized === "AMBIGUOUS") {
    return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  }
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function StorageUsageCell({
  instanceId,
  payload,
}: {
  instanceId: string;
  payload: SwarmStorageInstancePayload | undefined;
}) {
  const latest = payload?.latest;
  if (!latest) {
    return (
      <span className="text-muted-foreground" data-testid={`storage-usage-${instanceId}`}>
        No snapshots
      </span>
    );
  }

  const pct = usagePercent(latest.usedBytes, latest.totalBytes);
  if (latest.usedBytes == null && latest.totalBytes == null) {
    return (
      <span className="text-muted-foreground" data-testid={`storage-usage-${instanceId}`}>
        —
      </span>
    );
  }

  return (
    <div className="text-sm whitespace-nowrap" data-testid={`storage-usage-${instanceId}`}>
      <span className="font-medium">
        {formatBytes(latest.usedBytes)} / {formatBytes(latest.totalBytes)}
      </span>
      {pct != null ? <span className="ml-1 text-muted-foreground">({pct.toFixed(0)}%)</span> : null}
    </div>
  );
}

function StorageServicesCell({
  instanceId,
  payload,
}: {
  instanceId: string;
  payload: SwarmStorageInstancePayload | undefined;
}) {
  const services = payload?.latest?.services ?? [];
  if (services.length === 0) {
    return (
      <span className="text-muted-foreground" data-testid={`storage-services-${instanceId}`}>
        —
      </span>
    );
  }

  const shown = services.slice(0, SERVICES_PREVIEW_LIMIT);
  const rest = services.length - shown.length;

  return (
    <div className="max-w-[200px] space-y-0.5 text-xs" data-testid={`storage-services-${instanceId}`}>
      {shown.map((service, index) => (
        <div key={`${index}:${service.name}`} className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{truncateServiceName(service.name)}</span>
          <span className="shrink-0 text-muted-foreground">
            {service.sizeKnown ? formatBytes(service.sizeBytes) : "unknown"}
          </span>
        </div>
      ))}
      {rest > 0 ? <div className="text-muted-foreground">+{rest} more</div> : null}
      <Link
        href={`/admin/swarms/${instanceId}`}
        className="text-muted-foreground underline hover:text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        Details
      </Link>
    </div>
  );
}

function StorageStatusCell({
  instanceId,
  payload,
}: {
  instanceId: string;
  payload: SwarmStorageInstancePayload | undefined;
}) {
  const latest = payload?.latest;
  if (!latest) {
    return (
      <span className="text-muted-foreground" data-testid={`storage-status-${instanceId}`}>
        —
      </span>
    );
  }

  return (
    <div className="space-y-1" data-testid={`storage-status-${instanceId}`}>
      <Badge className={snapshotStatusClass(latest.status)}>{latest.status}</Badge>
      {latest.collectedAt ? (
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatCollectedAt(latest.collectedAt)}
        </div>
      ) : null}
    </div>
  );
}

function UsageSparkline({
  instanceId,
  history,
}: {
  instanceId: string;
  history: SwarmStorageHistoryPoint[] | undefined;
}) {
  const points = (history ?? []).filter(
    (point): point is SwarmStorageHistoryPoint & { usedBytes: number } =>
      point.usedBytes != null && Number.isFinite(point.usedBytes),
  );

  if (points.length === 0) {
    return (
      <span className="text-muted-foreground" data-testid={`storage-sparkline-${instanceId}`}>
        —
      </span>
    );
  }

  const values = points.map((point) => point.usedBytes);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lastX = Math.max(points.length - 1, 1);

  const coords = values.map((value, index) => {
    const x = (index / lastX) * SPARKLINE_WIDTH;
    const y = SPARKLINE_HEIGHT - 2 - ((value - min) / range) * (SPARKLINE_HEIGHT - 4);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      role="img"
      aria-label="Storage usage trend"
      data-testid={`storage-sparkline-${instanceId}`}
      className="text-foreground/70"
    >
      {points.length === 1 ? (
        <circle cx={SPARKLINE_WIDTH / 2} cy={SPARKLINE_HEIGHT / 2} r="2" fill="currentColor" />
      ) : (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={coords.join(" ")}
        />
      )}
    </svg>
  );
}

export default function SwarmsTable() {
  const router = useRouter();
  const [instances, setInstances] = useState<Ec2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "running" | "stopped">("all");
  const [sortState, setSortState] = useState<{ field: SortField; direction: SortDirection }>({
    field: "launchTime",
    direction: "desc",
  });
  const [updatingSwarms, setUpdatingSwarms] = useState<Set<string>>(new Set());
  const [storageByInstance, setStorageByInstance] = useState<SwarmStorageHistoryResponse>({});

  const fetchInstances = useCallback(async () => {
    try {
      const [instancesRes, storageRes] = await Promise.all([
        fetch("/api/admin/swarms"),
        fetch("/api/admin/swarms/storage").catch(() => null),
      ]);
      if (!instancesRes.ok) throw new Error(`Failed to fetch instances (${instancesRes.status})`);
      const data = await instancesRes.json();
      setInstances(data);
      setError(null);

      if (storageRes?.ok) {
        const storage = (await storageRes.json()) as SwarmStorageHistoryResponse;
        setStorageByInstance(storage && typeof storage === "object" ? storage : {});
      } else {
        setStorageByInstance({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const handleSort = (field: SortField) => {
    setSortState((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "asc" },
    );
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { instance, action } = pendingAction;

    setIsActing(true);
    try {
      const res = await fetch(`/api/admin/swarms/${instance.instanceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success(
        action === "start" ? `Instance ${instance.instanceId} started` : `Instance ${instance.instanceId} stopped`,
      );
      setPendingAction(null);
      setLoading(true);
      await fetchInstances();
    } catch (err) {
      toast.error(`Failed to ${action} instance`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsActing(false);
    }
  };

  const handleUpdateSwarm = async (instance: Ec2Instance, swarmUrl: string) => {
    setUpdatingSwarms((prev) => new Set(prev).add(instance.instanceId));
    try {
      const res = await fetch(`/api/admin/swarms/${instance.instanceId}/cmd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: { type: "Swarm", data: { cmd: "UpdateSwarm" } },
          swarmUrl,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success("Swarm updated");
    } catch (err) {
      toast.error("Failed to update swarm", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUpdatingSwarms((prev) => {
        const next = new Set(prev);
        next.delete(instance.instanceId);
        return next;
      });
    }
  };

  const createButton = (
    <div className="flex justify-end mb-4">
      <Button onClick={() => setCreateDialogOpen(true)} data-testid="open-create-swarm">
        <Plus className="mr-2 h-4 w-4" />
        Create Swarm
      </Button>
    </div>
  );

  const createDialog = (
    <CreateSwarmDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onCreated={fetchInstances} />
  );

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortState.field !== field) return null;
    return sortState.direction === "asc" ? (
      <ChevronUp className="inline w-4 h-4 ml-1" />
    ) : (
      <ChevronDown className="inline w-4 h-4 ml-1" />
    );
  };

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort(field)}>
      <div className="flex items-center">
        {children}
        <SortIcon field={field} />
      </div>
    </TableHead>
  );

  const filteredAndSorted = instances
    .filter((inst) => inst.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter((inst) => stateFilter === "all" || inst.state === stateFilter)
    .sort((a, b) => {
      let comparison = 0;
      if (sortState.field === "name") {
        comparison = a.name.localeCompare(b.name);
      } else {
        const aTime = a.launchTime ? new Date(a.launchTime).getTime() : 0;
        const bTime = b.launchTime ? new Date(b.launchTime).getTime() : 0;
        comparison = aTime - bTime;
      }
      return sortState.direction === "asc" ? comparison : -comparison;
    });

  if (loading) {
    return (
      <>
        {createButton}
        {createDialog}
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading instances…
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {createButton}
        {createDialog}
        <div className="py-8 text-center text-destructive">Error: {error}</div>
      </>
    );
  }

  if (instances.length === 0) {
    return (
      <>
        {createButton}
        {createDialog}
        <div className="py-8 text-center text-muted-foreground">No EC2 instances found with tag Swarm=superadmin.</div>
      </>
    );
  }

  return (
    <>
      {createButton}
      {createDialog}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as "all" | "running" | "stopped")}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader field="name">Name</SortableHeader>
            <TableHead>Instance ID</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Type</TableHead>
            <SortableHeader field="launchTime">Launch Time</SortableHeader>
            <TableHead>Public IP</TableHead>
            <TableHead>Private IP</TableHead>
            <TableHead>In Hive</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>Services</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Trend</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAndSorted.map((instance) => {
            const isTransitional = TRANSITIONAL_STATES.has(instance.state);
            const visibleTags = instance.tags.filter((t) => t.key !== "Name" && t.key !== "UserAssignedName");
            const userAssignedName = getUserAssignedName(instance.tags);
            const swarmUrl = userAssignedName ? `https://${userAssignedName}.sphinx.chat` : null;
            const isRunning = instance.state === "running";
            const isClickable = isRunning;
            const isUpdating = updatingSwarms.has(instance.instanceId);
            const storage = storageByInstance[instance.instanceId];

            return (
              <TableRow
                key={instance.instanceId}
                className={isClickable ? "cursor-pointer hover:bg-muted/30" : undefined}
                onClick={isClickable ? () => router.push(`/admin/swarms/${instance.instanceId}`) : undefined}
              >
                <TableCell className="font-medium">{instance.name}</TableCell>
                <TableCell className="font-mono text-sm">{instance.instanceId}</TableCell>
                <TableCell>
                  <StateBadge state={instance.state} />
                </TableCell>
                <TableCell>{instance.instanceType}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {instance.launchTime ? new Date(instance.launchTime).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">{instance.publicIp ?? "—"}</TableCell>
                <TableCell className="font-mono text-sm">{instance.privateIp ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {instance.hiveWorkspace ? (
                    <Link
                      href={`/admin/workspaces/${instance.hiveWorkspace.slug}`}
                      className="underline hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {instance.hiveWorkspace.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {userAssignedName ? `${userAssignedName}.sphinx.chat` : "—"}
                </TableCell>
                <TableCell>
                  <StorageUsageCell instanceId={instance.instanceId} payload={storage} />
                </TableCell>
                <TableCell>
                  <StorageServicesCell instanceId={instance.instanceId} payload={storage} />
                </TableCell>
                <TableCell>
                  <StorageStatusCell instanceId={instance.instanceId} payload={storage} />
                </TableCell>
                <TableCell>
                  <UsageSparkline instanceId={instance.instanceId} history={storage?.history} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {visibleTags.map((t) => `${t.key}=${t.value}`).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-2">
                    {isRunning && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Update Swarm"
                            disabled={isUpdating || !swarmUrl}
                            onClick={() => swarmUrl && handleUpdateSwarm(instance, swarmUrl)}
                            data-testid={`update-swarm-${instance.instanceId}`}
                          >
                            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Update Swarm</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Start"
                          disabled={isTransitional || instance.state !== "stopped"}
                          onClick={() => setPendingAction({ instance, action: "start" })}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Start</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon"
                          aria-label="Stop"
                          disabled={isTransitional || !isRunning}
                          onClick={() => setPendingAction({ instance, action: "stop" })}
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Stop</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      {filteredAndSorted.length === 0 && (searchQuery || stateFilter !== "all") && (
        <div className="py-8 text-center text-muted-foreground">No instances match the current filters.</div>
      )}

      <Dialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.action === "start" ? "Start" : "Stop"} instance {pendingAction?.instance.instanceId}?
            </DialogTitle>
            <DialogDescription>This will {pendingAction?.action} the EC2 instance. Are you sure?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)} disabled={isActing}>
              Cancel
            </Button>
            <Button
              variant={pendingAction?.action === "stop" ? "destructive" : "default"}
              onClick={handleConfirmAction}
              disabled={isActing}
            >
              {isActing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {pendingAction?.action === "start" ? "Starting…" : "Stopping…"}
                </>
              ) : pendingAction?.action === "start" ? (
                "Start Instance"
              ) : (
                "Stop Instance"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
