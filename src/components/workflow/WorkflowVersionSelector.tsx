"use client";

import React, { useEffect } from "react";
import { Loader2, GitBranch } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

interface WorkflowVersionSelectorProps {
  workflowName: string;
  versions: WorkflowVersion[];
  selectedVersionId: string | null;
  onVersionSelect: (versionId: string) => void;
  isLoading: boolean;
  /**
   * "default" — labelled, full-width trigger (used in TaskStartInput).
   * "compact" — label-less pill trigger with a branch icon (used in the
   * workflow inspector header where space is tight).
   */
  variant?: "default" | "compact";
}

function VersionBadges({
  isLatest,
  isActive,
  isPublished,
}: {
  isLatest: boolean;
  isActive: boolean;
  isPublished: boolean;
}) {
  return (
    <>
      {isLatest && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Latest
        </span>
      )}
      {isActive ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
          Active
        </span>
      ) : isPublished ? (
        <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Published
        </span>
      ) : null}
    </>
  );
}

export function WorkflowVersionSelector({
  versions,
  selectedVersionId,
  onVersionSelect,
  isLoading,
  variant = "default",
}: WorkflowVersionSelectorProps) {
  const isCompact = variant === "compact";

  // Auto-select first version if none selected and versions are available
  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      onVersionSelect(versions[0].workflow_version_id);
    }
  }, [versions, selectedVersionId, onVersionSelect]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 text-muted-foreground", !isCompact && "mt-4")}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading versions...</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", !isCompact && "mt-4")}>
        No versions found for this workflow
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    try {
      const num = Number(dateString);
      // Unix timestamp in seconds (numeric string like "1765974987.4301317")
      const date = !isNaN(num) && isFinite(num) ? new Date(num * 1000) : new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  const truncateId = (id: string) => (id.length > 8 ? id.substring(0, 8) : id);

  const selectedVersion =
    versions.find((v) => v.workflow_version_id === selectedVersionId) || versions[0];
  const activeVersionId = versions.find((v) => v.published)?.workflow_version_id ?? null;
  const latestVersionId = versions[0]?.workflow_version_id;

  const renderMeta = (version: WorkflowVersion, isLatest: boolean) => (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs">{truncateId(version.workflow_version_id)}</span>
      <span className="text-xs text-muted-foreground">{formatDate(version.date_added_to_graph)}</span>
      <VersionBadges
        isLatest={isLatest}
        isActive={version.workflow_version_id === activeVersionId}
        isPublished={version.published}
      />
    </div>
  );

  return (
    <div data-testid="version-selector" className={cn(!isCompact && "mt-4 space-y-2")}>
      {!isCompact && <label className="text-sm font-medium text-foreground">Select Version</label>}
      <Select
        value={selectedVersionId || latestVersionId}
        onValueChange={onVersionSelect}
      >
        <SelectTrigger
          className={cn(
            isCompact ? "h-9 w-auto gap-2 rounded-lg px-2.5 text-xs" : "h-10 w-full text-sm",
          )}
        >
          {isCompact && <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <SelectValue>
            {selectedVersion && renderMeta(selectedVersion, selectedVersion.workflow_version_id === latestVersionId)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {versions.map((version, index) => (
            <SelectItem
              key={version.workflow_version_id}
              value={version.workflow_version_id}
              className="cursor-pointer"
            >
              <div className="py-1">{renderMeta(version, index === 0)}</div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
