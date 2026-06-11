"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

interface WorkflowVersionListProps {
  versions: WorkflowVersion[];
  selectedVersionId: string | null;
  onVersionSelect: (id: string) => void;
}

const formatDate = (dateString: string) => {
  try {
    const num = Number(dateString);
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

export function WorkflowVersionList({
  versions,
  selectedVersionId,
  onVersionSelect,
}: WorkflowVersionListProps) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">No versions available.</p>
    );
  }

  const activeVersionId = versions.find((v) => v.published)?.workflow_version_id ?? null;

  return (
    <div className="overflow-y-auto max-h-64 space-y-1">
      {versions.map((version) => {
        const isSelected = version.workflow_version_id === selectedVersionId;
        return (
          <button
            key={version.workflow_version_id}
            onClick={() => onVersionSelect(version.workflow_version_id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted/70 ${
              isSelected ? "bg-muted" : ""
            }`}
          >
            <span className="font-mono text-xs text-muted-foreground shrink-0">
              {version.workflow_version_id.substring(0, 8)}
            </span>
            <span className="text-xs text-muted-foreground truncate flex-1">
              {formatDate(version.date_added_to_graph)}
            </span>
            {version.workflow_version_id === activeVersionId ? (
              <Badge variant="default" className="shrink-0 text-xs">Active</Badge>
            ) : version.published ? (
              <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">Published</Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
