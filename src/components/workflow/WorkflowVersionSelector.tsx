"use client";

import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

interface WorkflowVersionSelectorProps {
  workflowName: string;
  versions: WorkflowVersion[];
  selectedVersionId: string | null;
  onVersionSelect: (versionId: string) => void;
  isLoading: boolean;
}

export function WorkflowVersionSelector({
  workflowName,
  versions,
  selectedVersionId,
  onVersionSelect,
  isLoading,
}: WorkflowVersionSelectorProps) {
  // Auto-select first version if none selected and versions are available
  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      onVersionSelect(versions[0].workflow_version_id);
    }
  }, [versions, selectedVersionId, onVersionSelect]);

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading versions...</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return <div className="mt-4 text-sm text-muted-foreground">No versions found for this workflow</div>;
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

  const truncateId = (id: string) => {
    return id.length > 8 ? id.substring(0, 8) : id;
  };

  const selectedVersion = versions.find((v) => v.workflow_version_id === selectedVersionId) || versions[0];

  return (
    <div className="mt-4 space-y-2">
      <label className="text-sm font-medium text-foreground">Select Version</label>
      <Select value={selectedVersionId || versions[0]?.workflow_version_id} onValueChange={onVersionSelect}>
        <SelectTrigger className="w-full h-10 text-sm">
          <SelectValue>
            {selectedVersion && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{truncateId(selectedVersion.workflow_version_id)}</span>
                {selectedVersion.date_added_to_graph && (
                  <span className="text-xs text-muted-foreground">{formatDate(selectedVersion.date_added_to_graph)}</span>
                )}
                {selectedVersion.workflow_version_id === versions[0]?.workflow_version_id && (
                  <Badge variant="secondary" className="text-xs">
                    Latest
                  </Badge>
                )}
                {selectedVersion.published && (
                  <Badge variant="default" className="text-xs">
                    Published
                  </Badge>
                )}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {versions.map((version, index) => (
            <SelectItem
              key={version.workflow_version_id}
              value={version.workflow_version_id}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2 py-1">
                <span className="font-mono text-xs">{truncateId(version.workflow_version_id)}</span>
                {version.date_added_to_graph && (
                  <span className="text-xs text-muted-foreground">{formatDate(version.date_added_to_graph)}</span>
                )}
                {index === 0 && (
                  <Badge variant="secondary" className="text-xs">
                    Latest
                  </Badge>
                )}
                {version.published && (
                  <Badge variant="default" className="text-xs">
                    Published
                  </Badge>
                )}
                {!version.published && (
                  <Badge variant="default" className="text-xs">
                    Draft
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
