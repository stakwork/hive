"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { WorkspaceRole } from "@/lib/auth/roles";
import { StalePRTask } from "@/lib/github/stale-pr-janitor";
import { AlertTriangle, ExternalLink, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface StaleCITaskJanitorCardProps {
  slug: string;
  initialConfig: { stalePrTasksEnabled: boolean; stalePrTaskThresholdDays: number };
}

export function StaleCITaskJanitorCard({ slug, initialConfig }: StaleCITaskJanitorCardProps) {
  const { checkPermission } = useWorkspaceAccess();
  const canManage = checkPermission(WorkspaceRole.PM);

  const [enabled, setEnabled] = useState(initialConfig.stalePrTasksEnabled ?? false);
  const [thresholdDays, setThresholdDays] = useState(initialConfig.stalePrTaskThresholdDays ?? 7);
  const [thresholdInput, setThresholdInput] = useState(String(initialConfig.stalePrTaskThresholdDays ?? 7));
  const [previewTasks, setPreviewTasks] = useState<StalePRTask[] | null>(null);
  const [loading, setLoading] = useState<"idle" | "previewing" | "archiving">("idle");

  const updateConfig = async (patch: Record<string, boolean | number>) => {
    const res = await fetch(`/api/workspaces/${slug}/janitors/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("Failed to update config");
  };

  const handleToggle = async (newValue: boolean) => {
    const prev = enabled;
    setEnabled(newValue);
    try {
      await updateConfig({ stalePrTasksEnabled: newValue });
    } catch {
      setEnabled(prev);
      toast.error("Failed to update stale PR tasks setting");
    }
  };

  const handleThresholdSave = async () => {
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      toast.error("Threshold must be between 1 and 365 days");
      setThresholdInput(String(thresholdDays));
      return;
    }
    try {
      await updateConfig({ stalePrTaskThresholdDays: val });
      setThresholdDays(val);
      // Clear stale preview if threshold changed
      setPreviewTasks(null);
    } catch {
      toast.error("Failed to update threshold");
      setThresholdInput(String(thresholdDays));
    }
  };

  const handlePreview = async () => {
    setLoading("previewing");
    try {
      const res = await fetch(`/api/workspaces/${slug}/janitors/stale-pr-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry_run", thresholdDays }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setPreviewTasks(data.tasks ?? []);
    } catch {
      toast.error("Failed to preview stale tasks");
    } finally {
      setLoading("idle");
    }
  };

  const handleArchiveAll = async () => {
    setLoading("archiving");
    try {
      const res = await fetch(`/api/workspaces/${slug}/janitors/stale-pr-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "execute", thresholdDays }),
      });
      if (!res.ok) throw new Error("Archive failed");
      const data = await res.json();
      toast.success(`Archived ${data.archivedCount} stale task${data.archivedCount !== 1 ? "s" : ""}`);
      setPreviewTasks(null);
    } catch {
      toast.error("Failed to archive stale tasks");
    } finally {
      setLoading("idle");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Stale CI Task Janitor</CardTitle>
            {!canManage && (
              <Tooltip>
                <TooltipTrigger>
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Requires PM role or higher</TooltipContent>
              </Tooltip>
            )}
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={!canManage}
          />
        </div>
        <CardDescription>
          Detect and archive tasks permanently stuck in CI failure or merge conflict state.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {enabled && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              Threshold (days):
            </label>
            <Input
              type="number"
              min={1}
              max={365}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              onBlur={handleThresholdSave}
              onKeyDown={(e) => e.key === "Enter" && handleThresholdSave()}
              disabled={!canManage}
              className="w-24 h-8"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            disabled={!canManage || loading !== "idle"}
          >
            {loading === "previewing" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Preview stale tasks
          </Button>

          {previewTasks && previewTasks.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleArchiveAll}
              disabled={!canManage || loading !== "idle"}
            >
              {loading === "archiving" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Archive {previewTasks.length} task{previewTasks.length !== 1 ? "s" : ""}
            </Button>
          )}
        </div>

        {previewTasks !== null && (
          previewTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stale tasks found.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>PR</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Repo</TableHead>
                    <TableHead className="text-right">Days stuck</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewTasks.map((task) => (
                    <TableRow key={task.taskId}>
                      <TableCell className="max-w-[200px]">
                        <Link
                          href={`/w/${slug}/task/${task.taskId}`}
                          className="text-sm font-medium hover:underline truncate block"
                          title={task.taskTitle}
                        >
                          {task.taskTitle}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <a
                          href={task.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1 truncate"
                          title={task.prUrl}
                        >
                          <span className="truncate">{task.prUrl.replace("https://github.com/", "")}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell>
                        {task.state === "ci_failure" ? (
                          <Badge variant="destructive" className="text-xs">CI Failure</Badge>
                        ) : (
                          <Badge className="text-xs bg-amber-500 hover:bg-amber-600">Conflict</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[140px]">
                        <span className="text-sm text-muted-foreground truncate block" title={task.repoUrl}>
                          {task.repoUrl.replace("https://github.com/", "")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {Math.round(task.stuckSinceDays)}d
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
