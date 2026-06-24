"use client";

import React, { useState } from "react";
import { formatInUserTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";
import { groupWorkflowVersions } from "@/lib/utils/workflow-version-groups";

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

export function WorkflowVersionList({
  versions,
  selectedVersionId,
  onVersionSelect,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onCustomSelectionConfirm,
}: WorkflowVersionListProps) {
  const { timezone } = useUserTimezone();
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">No versions available.</p>
    );
  }

  const activeVersionId = versions.find((v) => v.published)?.workflow_version_id ?? null;
  const { unreleased, groups } = groupWorkflowVersions(versions);

  // Default: newest published group open; Unreleased starts collapsed
  const latestPublishedId = groups[0]?.publishedVersion.workflow_version_id ?? null;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(latestPublishedId ? [latestPublishedId] : []),
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleCheckboxChange = (versionId: string, checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      if (selectedIds.length >= 5) return;
      onSelectionChange([...selectedIds, versionId]);
    } else {
      onSelectionChange(selectedIds.filter((id) => id !== versionId));
    }
  };

  const showGenerateButton = selectable && selectedIds.length >= 2;

  /** Shared visual content for a version row (id, date, badge) */
  const renderRowContent = (version: WorkflowVersion) => (
    <>
      <span className="font-mono text-xs text-muted-foreground shrink-0">
        {version.workflow_version_id.substring(0, 8)}
      </span>
      <span className="text-xs text-muted-foreground truncate flex-1">
        {(() => {
          const s = version.date_added_to_graph;
          if (!s) return "—";
          try {
            const num = Number(s);
            const d = !isNaN(num) && isFinite(num) ? new Date(num * 1000) : new Date(s);
            return formatInUserTz(d, timezone);
          } catch { return s; }
        })()}
      </span>
      {version.workflow_version_id === activeVersionId ? (
        <Badge variant="default" className="shrink-0 text-xs">Active</Badge>
      ) : version.published ? (
        <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">Published</Badge>
      ) : null}
    </>
  );

  /**
   * A standalone (non-trigger) version row used for draft/unreleased versions.
   * Renders as a clickable button (non-selectable) or checkbox div (selectable).
   */
  const renderStandaloneRow = (version: WorkflowVersion) => {
    const isSelected = version.workflow_version_id === selectedVersionId;
    const isChecked = selectedIds.includes(version.workflow_version_id);
    const isCheckboxDisabled = !isChecked && selectedIds.length >= 5;

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
            {renderRowContent(version)}
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
        {renderRowContent(version)}
      </button>
    );
  };

  /**
   * Published version header — used as the CollapsibleTrigger row.
   *
   * Non-selectable: the trigger button is the entire row (chevron + content).
   * Selectable: the checkbox sits OUTSIDE the trigger button to avoid nested <button>
   *             (Radix Checkbox renders as a button).
   */
  const renderPublishedGroupHeader = (version: WorkflowVersion, isOpen: boolean, groupKey: string) => {
    const isSelected = version.workflow_version_id === selectedVersionId;
    const isChecked = selectedIds.includes(version.workflow_version_id);
    const isCheckboxDisabled = !isChecked && selectedIds.length >= 5;

    const chevron = (
      <ChevronRight
        className={`h-3 w-3 shrink-0 ml-2 flex-none transition-transform duration-200 ${
          isOpen ? "rotate-90" : ""
        }`}
      />
    );

    if (selectable) {
      // Checkbox outside the trigger button to avoid button-in-button
      return (
        <div className="flex items-center w-full rounded-md hover:bg-muted/50 transition-colors">
          <div className="pl-3 flex-none" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isChecked}
              disabled={isCheckboxDisabled}
              onCheckedChange={(checked) =>
                handleCheckboxChange(version.workflow_version_id, !!checked)
              }
              aria-label={`Select version ${version.workflow_version_id.substring(0, 8)}`}
            />
          </div>
          <CollapsibleTrigger className="flex items-center flex-1 min-w-0">
            {chevron}
            <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2 text-sm">
              {renderRowContent(version)}
            </div>
          </CollapsibleTrigger>
        </div>
      );
    }

    // Non-selectable: entire header is the trigger button; also selects the version
    return (
      <CollapsibleTrigger
        onClick={() => onVersionSelect(version.workflow_version_id)}
        className={`w-full flex items-center gap-1 rounded-md hover:bg-muted/50 transition-colors ${
          isSelected ? "bg-muted" : ""
        }`}
      >
        {chevron}
        <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2">
          {renderRowContent(version)}
        </div>
      </CollapsibleTrigger>
    );
  };

  return (
    <div>
      <div className="overflow-y-auto max-h-64 space-y-1">
        {/* Unreleased group */}
        {unreleased.length > 0 && (
          <Collapsible
            open={expandedGroups.has("unreleased")}
            onOpenChange={() => toggleGroup("unreleased")}
          >
            <CollapsibleTrigger className="w-full flex items-center gap-1 px-2 py-1 rounded-md text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
                  expandedGroups.has("unreleased") ? "rotate-90" : ""
                }`}
              />
              <span className="text-yellow-600 dark:text-yellow-400">Unreleased</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-3 space-y-0.5">
                {unreleased.map(renderStandaloneRow)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Published groups */}
        {groups.map((group) => {
          const key = group.publishedVersion.workflow_version_id;
          const isOpen = expandedGroups.has(key);

          return (
            <Collapsible
              key={key}
              open={isOpen}
              onOpenChange={() => toggleGroup(key)}
            >
              {renderPublishedGroupHeader(group.publishedVersion, isOpen, key)}

              {group.drafts.length > 0 && (
                <CollapsibleContent>
                  <div className="pl-5 space-y-0.5 border-l border-border/40 ml-3">
                    {group.drafts.map(renderStandaloneRow)}
                  </div>
                </CollapsibleContent>
              )}
            </Collapsible>
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
