"use client";

import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { TaskFilter } from "./FilterButton";

interface ActiveFiltersProps {
  filters: TaskFilter;
  onRemoveFilter: (category: keyof TaskFilter, value: string) => void;
}

const FILTER_LABELS: Record<string, string> = {
  // Workflow Status
  PENDING: "Open",
  IN_PROGRESS: "Running",
  COMPLETED: "Completed/Merged",
  ERROR: "Error",
  HALTED: "Halted",
  FAILED: "Failed",
  // Source Type
  JANITOR: "Janitor",
  USER: "User",
  TASK_COORDINATOR: "Task Coordinator",
  SYSTEM: "System",
  // Mode
  agent: "Agent",
  live: "Chat",
};

export function ActiveFilters({ filters, onRemoveFilter }: ActiveFiltersProps) {
  const hasFilters =
    (filters.workflowStatus?.length || 0) +
    (filters.sourceType?.length || 0) +
    (filters.mode?.length || 0) >
    0;

  if (!hasFilters) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {filters.workflowStatus?.map((value) => (
        <Badge key={`workflow-${value}`} variant="secondary" className="gap-1 pr-1">
          {FILTER_LABELS[value] || value}
          <button
            onClick={() => onRemoveFilter("workflowStatus", value)}
            className="ml-1 rounded-full hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {filters.sourceType?.map((value) => (
        <Badge key={`source-${value}`} variant="secondary" className="gap-1 pr-1">
          {FILTER_LABELS[value] || value}
          <button
            onClick={() => onRemoveFilter("sourceType", value)}
            className="ml-1 rounded-full hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {filters.mode?.map((value) => (
        <Badge key={`mode-${value}`} variant="secondary" className="gap-1 pr-1">
          {FILTER_LABELS[value] || value}
          <button
            onClick={() => onRemoveFilter("mode", value)}
            className="ml-1 rounded-full hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
