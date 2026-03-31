"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, ChevronUp, ChevronDown, Plus } from "lucide-react";
import CreateSwarmDialog from "./CreateSwarmDialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

function getUserAssignedName(tags: { key: string; value: string }[]): string | null {
  return tags.find((t) => t.key === "UserAssignedName")?.value ?? null;
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
  const [sortState, setSortState] = useState<{ field: SortField; direction: SortDirection }>({
    field: "launchTime",
    direction: "desc",
  });
  const [updatingSwarms, setUpdatingSwarms] = useState<Set<string>>(new Set());

  const fetchInstances = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/swarms");
      if (!res.ok) throw new Error(`Failed to fetch instances (${res.status})`);
      const data = await res.json();
      setInstances(data);
      setError(null);
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
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Filter by name…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

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
            const isClickable = isRunning && !!userAssignedName;
            const isUpdating = updatingSwarms.has(instance.instanceId);

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
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {visibleTags.map((t) => `${t.key}=${t.value}`).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {isTransitional ? (
                    <Button variant="outline" size="sm" disabled>
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </Button>
                  ) : isRunning ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isUpdating || !swarmUrl}
                        onClick={() => swarmUrl && handleUpdateSwarm(instance, swarmUrl)}
                        data-testid={`update-swarm-${instance.instanceId}`}
                      >
                        {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Update Swarm"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setPendingAction({ instance, action: "stop" })}
                      >
                        Stop
                      </Button>
                    </div>
                  ) : instance.state === "stopped" ? (
                    <Button variant="outline" size="sm" onClick={() => setPendingAction({ instance, action: "start" })}>
                      Start
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {filteredAndSorted.length === 0 && searchQuery && (
        <div className="py-8 text-center text-muted-foreground">No instances match &quot;{searchQuery}&quot;.</div>
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
