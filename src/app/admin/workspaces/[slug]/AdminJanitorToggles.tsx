"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { JANITOR_CONFIG } from "@/lib/constants/janitor";
import { JanitorType } from "@prisma/client";

interface AdminJanitorTogglesProps {
  workspaceId: string;
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
};

export default function AdminJanitorToggles({
  workspaceId,
}: AdminJanitorTogglesProps) {
  const [config, setConfig] = useState<JanitorConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(
          `/api/admin/workspaces/${workspaceId}/janitors`
        );
        const data = await response.json();
        setConfig(data.config);
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [field]: value }),
      });
    } catch (error) {
      console.error("Failed to update janitor config:", error);
      // Revert on error
      setConfig({ ...config, [field]: !value });
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

  // Add additional toggles
  Object.entries(ADDITIONAL_TOGGLE_LABELS).forEach(([field, label]) => {
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
            checked={config[field]}
            onCheckedChange={(checked) => handleToggle(field, checked)}
          />
        </div>
      ))}
    </div>
  );
}
