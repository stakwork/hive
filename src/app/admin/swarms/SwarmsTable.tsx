"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus } from "lucide-react";
import CreateSwarmDialog from "./CreateSwarmDialog";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
}

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

  return (
    <Badge className={variants[state] ?? "bg-gray-100 text-gray-700"}>
      {state}
    </Badge>
  );
}

const TRANSITIONAL_STATES = new Set(["pending", "stopping", "shutting-down", "rebooting"]);

export default function SwarmsTable() {
  const [instances, setInstances] = useState<Ec2Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { instance, action } = pendingAction;

    setIsActing(true);
    try {
      const res = await fetch(
        `/api/admin/swarms/${instance.instanceId}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success(
        action === "start"
          ? `Instance ${instance.instanceId} started`
          : `Instance ${instance.instanceId} stopped`
      );
      setPendingAction(null);
      setLoading(true);
      await fetchInstances();
    } catch (err) {
      toast.error(
        `Failed to ${action} instance`,
        { description: err instanceof Error ? err.message : "Unknown error" }
      );
    } finally {
      setIsActing(false);
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
    <CreateSwarmDialog
      open={createDialogOpen}
      onOpenChange={setCreateDialogOpen}
      onCreated={fetchInstances}
    />
  );

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
        <div className="py-8 text-center text-destructive">
          Error: {error}
        </div>
      </>
    );
  }

  if (instances.length === 0) {
    return (
      <>
        {createButton}
        {createDialog}
        <div className="py-8 text-center text-muted-foreground">
          No EC2 instances found with tag Swarm=superadmin.
        </div>
      </>
    );
  }

  return (
    <>
      {createButton}
      {createDialog}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Instance ID</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Launch Time</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance) => {
            const isTransitional = TRANSITIONAL_STATES.has(instance.state);
            const visibleTags = instance.tags.filter(
              (t) => t.key !== "Name"
            );

            return (
              <TableRow key={instance.instanceId}>
                <TableCell className="font-medium">{instance.name}</TableCell>
                <TableCell className="font-mono text-sm">
                  {instance.instanceId}
                </TableCell>
                <TableCell>
                  <StateBadge state={instance.state} />
                </TableCell>
                <TableCell>{instance.instanceType}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {instance.launchTime
                    ? new Date(instance.launchTime).toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                  {visibleTags.map((t) => `${t.key}=${t.value}`).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right">
                  {isTransitional ? (
                    <Button variant="outline" size="sm" disabled>
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </Button>
                  ) : instance.state === "running" ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setPendingAction({ instance, action: "stop" })
                      }
                    >
                      Stop
                    </Button>
                  ) : instance.state === "stopped" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPendingAction({ instance, action: "start" })
                      }
                    >
                      Start
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.action === "start" ? "Start" : "Stop"} instance{" "}
              {pendingAction?.instance.instanceId}?
            </DialogTitle>
            <DialogDescription>
              This will {pendingAction?.action} the EC2 instance. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingAction(null)}
              disabled={isActing}
            >
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
