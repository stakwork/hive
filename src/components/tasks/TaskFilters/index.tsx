"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { FilterDropdownHeader } from "@/components/features/TableColumnHeaders";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

export interface TaskFiltersType {
  sourceType?: string;
  status?: string;
  priority?: string;
  hasPod?: boolean;
  createdById?: string;
}

interface TaskFiltersProps {
  filters: TaskFiltersType;
  onFiltersChange: (filters: TaskFiltersType) => void;
  onClearFilters: () => void;
  workspaceSlug: string;
}

const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "running", label: "Running" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ERROR", label: "Error" },
  { value: "HALTED", label: "Halted" },
  { value: "FAILED", label: "Failed" },
];

const PRIORITY_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const SOURCE_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "USER", label: "User" },
  { value: "JANITOR", label: "Janitor" },
  { value: "TASK_COORDINATOR", label: "Task Coordinator" },
  { value: "SYSTEM", label: "System" },
  { value: "PROTOTYPE", label: "Prototype" },
];

const POD_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "true", label: "Has Pod" },
  { value: "false", label: "No Pod" },
];

export function TaskFilters({
  filters,
  onFiltersChange,
  onClearFilters,
  workspaceSlug,
}: TaskFiltersProps) {
  const { members } = useWorkspaceMembers(workspaceSlug, { includeSystemAssignees: false });
  const hasActiveFilters = Object.keys(filters).length > 0;

  const creatorOptions = [
    { value: "ALL", label: "All", image: null },
    ...members.map((m) => ({
      value: m.user.id,
      label: m.user.name || m.user.email || "Unknown",
      image: m.user.image,
    })),
  ];


  const handleStatusChange = (val: string) => {
    const newFilters = { ...filters };
    if (val === "ALL") {
      delete newFilters.status;
    } else {
      newFilters.status = val;
    }
    onFiltersChange(newFilters);
  };

  const handlePriorityChange = (val: string) => {
    const newFilters = { ...filters };
    if (val === "ALL") {
      delete newFilters.priority;
    } else {
      newFilters.priority = val;
    }
    onFiltersChange(newFilters);
  };

  const handleSourceTypeChange = (val: string) => {
    const newFilters = { ...filters };
    if (val === "ALL") {
      delete newFilters.sourceType;
    } else {
      newFilters.sourceType = val;
    }
    onFiltersChange(newFilters);
  };

  const handleHasPodChange = (val: string) => {
    const newFilters = { ...filters };
    if (val === "ALL") {
      delete newFilters.hasPod;
    } else {
      newFilters.hasPod = val === "true";
    }
    onFiltersChange(newFilters);
  };

  const handleCreatedByChange = (val: string) => {
    const newFilters = { ...filters };
    if (val === "ALL") {
      delete newFilters.createdById;
    } else {
      newFilters.createdById = val;
    }
    onFiltersChange(newFilters);
  };

  return (
    <div className="flex items-center gap-2">
      <div data-testid="task-filter-status">
        <FilterDropdownHeader
          label="Status"
          options={STATUS_OPTIONS}
          value={filters.status ?? "ALL"}
          onChange={(val) => handleStatusChange(val as string)}
          multiSelect={false}
        />
      </div>

      <div data-testid="task-filter-priority">
        <FilterDropdownHeader
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={filters.priority ?? "ALL"}
          onChange={(val) => handlePriorityChange(val as string)}
          multiSelect={false}
          showPriorityBadges={true}
        />
      </div>

      <div data-testid="task-filter-source">
        <FilterDropdownHeader
          label="Source"
          options={SOURCE_OPTIONS}
          value={filters.sourceType ?? "ALL"}
          onChange={(val) => handleSourceTypeChange(val as string)}
          multiSelect={false}
        />
      </div>

      <div data-testid="task-filter-pod">
        <FilterDropdownHeader
          label="Pod"
          options={POD_OPTIONS}
          value={filters.hasPod !== undefined ? String(filters.hasPod) : "ALL"}
          onChange={(val) => handleHasPodChange(val as string)}
          multiSelect={false}
        />
      </div>

      <div data-testid="task-filter-creator">
        <FilterDropdownHeader
          label="Creator"
          options={creatorOptions}
          value={filters.createdById ?? "ALL"}
          onChange={(val) => handleCreatedByChange(val as string)}
          multiSelect={false}
          showSearch={true}
          showAvatars={true}
        />
      </div>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="h-8 px-2"
          data-testid="clear-filters-button"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
