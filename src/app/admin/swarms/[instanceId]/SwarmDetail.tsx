"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import HostStorageCard from "./HostStorageCard";
import FluentbitStatsCard from "./FluentbitStatsCard";
import { swarmUrlFromTags } from "@/lib/swarm/swarm-url";

interface Container {
  name: string;
  status: string;
  image: string;
}

/**
 * Raw shape returned by the Docker API (via the sphinx-swarm `ListContainers`
 * command). Keys are capitalized and, for the name, nested in an array —
 * unlike the flat lowercase `Container` shape the UI renders.
 */
interface RawDockerContainer {
  Names?: string[];
  State?: string;
  Status?: string;
  Image?: string;
  name?: string;
  status?: string;
  image?: string;
}

/**
 * Normalizes a container object — which may come back from the swarm host
 * either as a raw Docker API object (capitalized, nested keys) or already in
 * the flat lowercase UI shape — into the `Container` shape the table renders.
 *
 * `status` intentionally carries the Docker *state* (e.g. "running",
 * "created") rather than the human-readable `Status` string (e.g. "Up 4
 * hours"), since the UI's `isRunning` check compares against `"running"`.
 */
export function normalizeContainer(raw: RawDockerContainer): Container {
  const rawName = Array.isArray(raw?.Names) ? raw.Names[0] : undefined;
  const name = rawName ? rawName.replace(/^\//, "") : raw?.name ?? "";
  const status = raw?.State ?? raw?.status ?? "";
  const image = raw?.Image ?? raw?.image ?? "";

  return { name, status, image };
}

interface SwarmDetailProps {
  instanceId: string;
  swarmUrl?: string;
  name?: string;
}

type ActionLoading = {
  type: "container";
  containerName: string;
  action: "start" | "stop" | "restart" | "logs";
} | {
  type: "swarm";
  action: "getConfig" | "listVersions" | "getAllImageVersions" | "updateNode";
} | null;

interface ResultDialog {
  title: string;
  content: string;
}

interface LogsDialog {
  containerName: string;
  logs: string;
}

async function postCmd(instanceId: string, swarmUrl: string | undefined, cmd: Record<string, unknown>) {
  const body: Record<string, unknown> = { cmd };
  if (swarmUrl) body.swarmUrl = swarmUrl;

  const res = await fetch(`/api/admin/swarms/${instanceId}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data;
}

export default function SwarmDetail({ instanceId, swarmUrl, name }: SwarmDetailProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(swarmUrl);
  const [containers, setContainers] = useState<Container[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<ActionLoading>(null);
  const [resultDialog, setResultDialog] = useState<ResultDialog | null>(null);
  const [logsDialog, setLogsDialog] = useState<LogsDialog | null>(null);
  const [updateNodeDialog, setUpdateNodeDialog] = useState(false);
  const [updateNodePayload, setUpdateNodePayload] = useState("{}");

  const fetchContainers = useCallback(async (url: string) => {
    setLoadingContainers(true);
    setLoadError(null);
    try {
      const data = await postCmd(instanceId, url, {
        type: "Swarm",
        data: { cmd: "ListContainers" },
      });
      const body = (data as any)?.data ?? data;
      const list = Array.isArray(body)
        ? body
        : Array.isArray((body as any)?.containers)
          ? (body as any).containers
          : [];
      setContainers((list as RawDockerContainer[]).map(normalizeContainer));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load containers");
    } finally {
      setLoadingContainers(false);
    }
  }, [instanceId]);

  useEffect(() => {
    let cancelled = false;

    async function resolveThenFetch() {
      if (swarmUrl) {
        setResolvedUrl(swarmUrl);
        await fetchContainers(swarmUrl);
        return;
      }

      setLoadingContainers(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/admin/swarms/${instanceId}`);
        if (cancelled) return;

        if (res.status === 404) {
          setLoadError("Instance not found");
          setLoadingContainers(false);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setLoadError(data?.error ?? `Failed to resolve swarm URL (${res.status})`);
          setLoadingContainers(false);
          return;
        }

        const instance = await res.json();
        if (cancelled) return;

        const url = swarmUrlFromTags(instance?.tags);
        if (!url) {
          setLoadError("Could not resolve swarm URL — UserAssignedName tag is missing");
          setLoadingContainers(false);
          return;
        }

        setResolvedUrl(url);
        await fetchContainers(url);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to resolve swarm URL");
        setLoadingContainers(false);
      }
    }

    resolveThenFetch();
    return () => {
      cancelled = true;
    };
  }, [instanceId, swarmUrl, fetchContainers]);

  async function handleContainerAction(
    container: Container,
    action: "start" | "stop" | "restart" | "logs"
  ) {
    setActionLoading({ type: "container", containerName: container.name, action });
    try {
      const cmdMap = {
        start: { type: "Swarm", data: { cmd: "StartContainer", content: container.name } },
        stop: { type: "Swarm", data: { cmd: "StopContainer", content: container.name } },
        restart: { type: "Swarm", data: { cmd: "RestartContainer", content: container.name } },
        logs: { type: "Swarm", data: { cmd: "GetContainerLogs", content: { name: container.name, before_timestamp: null, since_timestamp: null } } },
      };

      const data = await postCmd(instanceId, resolvedUrl, cmdMap[action]);

      if (action === "logs") {
        const logs = data?.logs ?? data?.data?.logs ?? data?.rawText ?? JSON.stringify(data, null, 2);
        setLogsDialog({ containerName: container.name, logs: String(logs) });
      } else {
        toast.success(`Container ${action} successful`);
        if (resolvedUrl) await fetchContainers(resolvedUrl);
      }
    } catch (err) {
      toast.error(`Failed to ${action} container`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSwarmAction(action: "getConfig" | "listVersions" | "getAllImageVersions") {
    setActionLoading({ type: "swarm", action });
    const cmdMap = {
      getConfig: { type: "Swarm", data: { cmd: "GetConfig" } },
      listVersions: { type: "Swarm", data: { cmd: "ListVersions", content: {} } },
      getAllImageVersions: { type: "Swarm", data: { cmd: "GetAllImageActualVersion" } },
    };
    const titles = {
      getConfig: "Get Config",
      listVersions: "List Versions",
      getAllImageVersions: "Get All Image Versions",
    };
    try {
      const data = await postCmd(instanceId, resolvedUrl, cmdMap[action]);
      const result = data?.data ?? data;
      setResultDialog({
        title: titles[action],
        content: JSON.stringify(result, null, 2),
      });
    } catch (err) {
      toast.error(`Failed: ${titles[action]}`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUpdateNode() {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(updateNodePayload);
    } catch {
      toast.error("Invalid JSON payload");
      return;
    }
    setUpdateNodeDialog(false);
    setActionLoading({ type: "swarm", action: "updateNode" });
    try {
      const data = await postCmd(instanceId, resolvedUrl, {
        type: "Swarm",
        data: { cmd: "UpdateNode", content: payload },
      });
      const result = data?.data ?? data;
      setResultDialog({
        title: "Update Node",
        content: JSON.stringify(result, null, 2),
      });
    } catch (err) {
      toast.error("Failed: Update Node", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setActionLoading(null);
    }
  }

  function isContainerActionLoading(containerName: string, action: string) {
    return (
      actionLoading?.type === "container" &&
      actionLoading.containerName === containerName &&
      actionLoading.action === action
    );
  }

  function isSwarmActionLoading(action: string) {
    return actionLoading?.type === "swarm" && actionLoading.action === action;
  }

  const displayName = name ?? instanceId;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/swarms"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Swarms
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold font-mono">{displayName}</h1>
      </div>

      {/* Container Table Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Containers</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resolvedUrl && fetchContainers(resolvedUrl)}
            disabled={loadingContainers || !resolvedUrl}
          >
            {loadingContainers ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent>
          {loadingContainers ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading containers…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span>{loadError}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolvedUrl && fetchContainers(resolvedUrl)}
                disabled={!resolvedUrl}
              >
                Retry
              </Button>
            </div>
          ) : containers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No containers found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((container) => {
                  const isRunning = container.status === "running";
                  return (
                    <TableRow key={container.name}>
                      <TableCell className="font-mono font-medium">{container.name}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            isRunning
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          }
                        >
                          {container.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {container.image}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isRunning && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionLoading !== null || !resolvedUrl}
                              onClick={() => handleContainerAction(container, "start")}
                            >
                              {isContainerActionLoading(container.name, "start") ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Start"
                              )}
                            </Button>
                          )}
                          {isRunning && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={actionLoading !== null || !resolvedUrl}
                              onClick={() => handleContainerAction(container, "stop")}
                            >
                              {isContainerActionLoading(container.name, "stop") ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Stop"
                              )}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionLoading !== null || !resolvedUrl}
                            onClick={() => handleContainerAction(container, "restart")}
                          >
                            {isContainerActionLoading(container.name, "restart") ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Restart"
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionLoading !== null || !resolvedUrl}
                            onClick={() => handleContainerAction(container, "logs")}
                          >
                            {isContainerActionLoading(container.name, "logs") ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Logs"
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Swarm Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Swarm Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading !== null || !resolvedUrl}
              onClick={() => handleSwarmAction("getConfig")}
            >
              {isSwarmActionLoading("getConfig") ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Get Config
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading !== null || !resolvedUrl}
              onClick={() => handleSwarmAction("listVersions")}
            >
              {isSwarmActionLoading("listVersions") ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              List Versions
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading !== null || !resolvedUrl}
              onClick={() => handleSwarmAction("getAllImageVersions")}
            >
              {isSwarmActionLoading("getAllImageVersions") ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Get All Image Versions
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading !== null || !resolvedUrl}
              onClick={() => setUpdateNodeDialog(true)}
            >
              {isSwarmActionLoading("updateNode") ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Update Node
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <HostStorageCard instanceId={instanceId} />
        <FluentbitStatsCard instanceId={instanceId} />
      </div>

      {/* Logs Dialog */}
      <Dialog open={logsDialog !== null} onOpenChange={(open) => !open && setLogsDialog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Logs — {logsDialog?.containerName}</DialogTitle>
            <DialogDescription>Container log output</DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto text-xs font-mono bg-muted p-4 rounded whitespace-pre-wrap">
            {logsDialog?.logs ?? ""}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={resultDialog !== null} onOpenChange={(open) => !open && setResultDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{resultDialog?.title}</DialogTitle>
            <DialogDescription>Command result</DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto text-xs font-mono bg-muted p-4 rounded whitespace-pre-wrap">
            {resultDialog?.content ?? ""}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Update Node Dialog */}
      <Dialog open={updateNodeDialog} onOpenChange={setUpdateNodeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Update Node</DialogTitle>
            <DialogDescription>Enter the node configuration as JSON.</DialogDescription>
          </DialogHeader>
          <Textarea
            className="font-mono text-sm min-h-[160px]"
            value={updateNodePayload}
            onChange={(e) => setUpdateNodePayload(e.target.value)}
            placeholder='{"key": "value"}'
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateNodeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateNode}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
