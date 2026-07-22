"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JANITOR_CONFIG } from "@/lib/constants/janitor";
import { JanitorType } from "@prisma/client";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { StalePRTask } from "@/lib/github/stale-pr-janitor";

interface AdminJanitorTogglesProps {
  workspaceId: string;
  workspaceSlug: string;
}

interface JanitorConfig {
  unitTestsEnabled: boolean;
  integrationTestsEnabled: boolean;
  e2eTestsEnabled: boolean;
  securityReviewEnabled: boolean;
  mockGenerationEnabled: boolean;
  generalRefactoringEnabled: boolean;
  taskCoordinatorEnabled: boolean;
  recommendationSweepEnabled: boolean;
  ticketSweepEnabled: boolean;
  prMonitorEnabled: boolean;
  prConflictFixEnabled: boolean;
  prCiFailureFixEnabled: boolean;
  prOutOfDateFixEnabled: boolean;
  prUseMergeForUpdates: boolean;
  prUseRebaseForUpdates: boolean;
  stalePrTasksEnabled: boolean;
  stalePrTaskThresholdDays: number;
  legalBenchmarkRecursionEnabled?: boolean;
}

const ADDITIONAL_TOGGLE_LABELS: Record<string, string> = {
  taskCoordinatorEnabled: "Task Coordinator",
  recommendationSweepEnabled: "Recommendation Sweep",
  ticketSweepEnabled: "Ticket Sweep",
  prMonitorEnabled: "PR Monitoring",
  prConflictFixEnabled: "Auto-fix Conflicts",
  prCiFailureFixEnabled: "Auto-fix CI Failures",
  prOutOfDateFixEnabled: "Auto-update Branches",
  prUseMergeForUpdates: "Merge Strategy",
  prUseRebaseForUpdates: "Rebase Strategy",
  stalePrTasksEnabled: "Stale CI Task Janitor",
};

export default function AdminJanitorToggles({
  workspaceId,
  workspaceSlug,
}: AdminJanitorTogglesProps) {
  const [config, setConfig] = useState<JanitorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [thresholdInput, setThresholdInput] = useState("7");

  // Stale janitor run state
  const [runLoading, setRunLoading] = useState<"idle" | "previewing" | "archiving">("idle");
  const [staleResults, setStaleResults] = useState<StalePRTask[] | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(
          `/api/admin/workspaces/${workspaceId}/janitors`
        );
        const data = await response.json();
        setConfig(data.config);
        setThresholdInput(String(data.config?.stalePrTaskThresholdDays ?? 7));
      } catch (error) {
        console.error("Failed to fetch janitor config:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [workspaceId]);

  const handleToggle = async (field: keyof JanitorConfig, value: boolean) => {
    if (!config) return;

    // Optimistic update
    setConfig({ ...config, [field]: value });

    try {
      await fetch(`/api/admin/workspaces/${workspaceId}/janitors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch (error) {
      console.error("Failed to update janitor config:", error);
      // Revert on error
      setConfig({ ...config, [field]: !value });
    }
  };

  const handleThresholdSave = async () => {
    if (!config) return;
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 1 || val > 365) {
      setThresholdInput(String(config.stalePrTaskThresholdDays));
      return;
    }
    const prev = config.stalePrTaskThresholdDays;
    setConfig({ ...config, stalePrTaskThresholdDays: val });
    try {
      await fetch(`/api/admin/workspaces/${workspaceId}/janitors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stalePrTaskThresholdDays: val }),
      });
    } catch {
      setConfig({ ...config, stalePrTaskThresholdDays: prev });
      setThresholdInput(String(prev));
    }
  };

  const handleRunPreview = async () => {
    setRunLoading("previewing");
    try {
      const res = await fetch(`/api/admin/janitor/stale-pr-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "dry_run",
          workspaceId,
          thresholdDays: config?.stalePrTaskThresholdDays ?? 7,
        }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setStaleResults(data.tasks ?? []);
      setResultsOpen(true);
    } catch {
      console.error("Failed to preview stale tasks");
    } finally {
      setRunLoading("idle");
    }
  };

  const handleArchiveAll = async () => {
    setRunLoading("archiving");
    try {
      const res = await fetch(`/api/admin/janitor/stale-pr-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "execute",
          workspaceId,
          thresholdDays: config?.stalePrTaskThresholdDays ?? 7,
        }),
      });
      if (!res.ok) throw new Error("Archive failed");
      const data = await res.json();
      setStaleResults(null);
      setResultsOpen(false);
      console.log(`Archived ${data.archivedCount} stale tasks`);
    } catch {
      console.error("Failed to archive stale tasks");
    } finally {
      setRunLoading("idle");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-6 w-11" />
          </div>
        ))}
      </div>
    );
  }

  if (!config) {
    return <div className="text-muted-foreground">Failed to load configuration</div>;
  }

  // Build toggles array from JANITOR_CONFIG and additional toggles
  const toggles: Array<{ field: keyof JanitorConfig; label: string }> = [];

  // Add toggles from JANITOR_CONFIG
  Object.entries(JANITOR_CONFIG).forEach(([_, janitorConfig]) => {
    toggles.push({
      field: janitorConfig.enabledField as keyof JanitorConfig,
      label: janitorConfig.name,
    });
  });

  // Add additional toggles (excluding stalePrTasksEnabled — rendered separately below)
  const additionalToggleEntries = Object.entries(ADDITIONAL_TOGGLE_LABELS).filter(
    ([field]) => field !== "stalePrTasksEnabled"
  );
  additionalToggleEntries.forEach(([field, label]) => {
    toggles.push({
      field: field as keyof JanitorConfig,
      label,
    });
  });

  return (
    <div className="space-y-4">
      {toggles.map(({ field, label }) => (
        <div key={field} className="flex items-center justify-between">
          <label htmlFor={field} className="text-sm font-medium cursor-pointer">
            {label}
          </label>
          <Switch
            id={field}
            checked={config[field] as boolean}
            onCheckedChange={(checked) => handleToggle(field, checked)}
          />
        </div>
      ))}

      {/* Legal Benchmarks — OpenLaw workspace only */}
      {workspaceSlug === "openlaw" && (
        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Legal Benchmark Recursion Janitor</label>
            <Switch
              checked={config.legalBenchmarkRecursionEnabled ?? false}
              onCheckedChange={(checked) => handleToggle("legalBenchmarkRecursionEnabled", checked)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Re-runs failing benchmark evals every 6 hours until all rubrics pass.
          </p>
        </div>
      )}

      {/* Stale CI Task Janitor — separate section with threshold + run controls */}
      <div className="border rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Stale CI Task Janitor</label>
          <Switch
            checked={config.stalePrTasksEnabled}
            onCheckedChange={(checked) => handleToggle("stalePrTasksEnabled", checked)}
          />
        </div>

        {config.stalePrTasksEnabled && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Threshold (days):</span>
            <Input
              type="number"
              min={1}
              max={365}
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              onBlur={handleThresholdSave}
              onKeyDown={(e) => e.key === "Enter" && handleThresholdSave()}
              className="w-20 h-7 text-sm"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunPreview}
            disabled={runLoading !== "idle"}
          >
            {runLoading === "previewing" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Run Janitor Now
          </Button>

          {staleResults && staleResults.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleArchiveAll}
              disabled={runLoading !== "idle"}
            >
              {runLoading === "archiving" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Archive {staleResults.length} task{staleResults.length !== 1 ? "s" : ""}
            </Button>
          )}

          {staleResults && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"
              onClick={() => setResultsOpen((o) => !o)}
            >
              {resultsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {staleResults.length === 0 ? "No stale tasks" : `${staleResults.length} found`}
            </button>
          )}
        </div>

        {resultsOpen && staleResults && staleResults.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {staleResults.map((task) => (
              <div key={task.taskId} className="flex items-center gap-2 text-xs">
                <Badge
                  variant={task.state === "ci_failure" ? "destructive" : "outline"}
                  className={`shrink-0 ${task.state === "conflict" ? "bg-amber-500 text-white border-0" : ""}`}
                >
                  {task.state === "ci_failure" ? "CI" : "Conflict"}
                </Badge>
                <span className="truncate flex-1 font-medium" title={task.taskTitle}>
                  {task.taskTitle}
                </span>
                <span className="shrink-0 text-muted-foreground">{Math.round(task.stuckSinceDays)}d</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
