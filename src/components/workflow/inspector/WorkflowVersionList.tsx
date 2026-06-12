"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

interface WorkflowVersionListProps {
  versions: WorkflowVersion[];
  selectedVersionId: string | null;
  onVersionSelect: (id: string) => void;
  // Selectable / custom picker mode
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onCustomSelectionConfirm?: () => void;
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
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onCustomSelectionConfirm,
}: WorkflowVersionListProps) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">No versions available.</p>
    );
  }

  const activeVersionId = versions.find((v) => v.published)?.workflow_version_id ?? null;

  const handleCheckboxChange = (versionId: string, checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      if (selectedIds.length >= 5) return; // max 5
      onSelectionChange([...selectedIds, versionId]);
    } else {
      onSelectionChange(selectedIds.filter((id) => id !== versionId));
    }
  };

  const showGenerateButton = selectable && selectedIds.length >= 2;

  return (
    <div>
      <div className="overflow-y-auto max-h-64 space-y-1">
        {versions.map((version) => {
          const isSelected = version.workflow_version_id === selectedVersionId;
          const isChecked = selectedIds.includes(version.workflow_version_id);
          const isCheckboxDisabled = !isChecked && selectedIds.length >= 5;

          const rowContent = (
            <>
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
            </>
          );

          if (selectable) {
            return (
              <div
                key={version.workflow_version_id}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted/70"
              >
                <Checkbox
                  checked={isChecked}
                  disabled={isCheckboxDisabled}
                  onCheckedChange={(checked) =>
                    handleCheckboxChange(version.workflow_version_id, !!checked)
                  }
                  aria-label={`Select version ${version.workflow_version_id.substring(0, 8)}`}
                />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {rowContent}
                </div>
              </div>
            );
          }

          return (
            <button
              key={version.workflow_version_id}
              onClick={() => onVersionSelect(version.workflow_version_id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted/70 ${
                isSelected ? "bg-muted" : ""
              }`}
            >
              {rowContent}
            </button>
          );
        })}
      </div>

      {showGenerateButton && (
        <div className="mt-2 px-1">
          <Button
            size="sm"
            variant="default"
            onClick={onCustomSelectionConfirm}
            className="w-full"
          >
            Generate Summary ({selectedIds.length} selected)
          </Button>
        </div>
      )}
    </div>
  );
}
