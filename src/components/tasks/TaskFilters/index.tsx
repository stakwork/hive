"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Filter, X } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export interface TaskFiltersType {
  sourceType?: string;
  status?: string;
  priority?: string;
  hasPod?: boolean;
}

interface TaskFiltersProps {
  filters: TaskFiltersType;
  onFiltersChange: (filters: TaskFiltersType) => void;
  onClearFilters: () => void;
}

const SOURCE_TYPES = [
  { value: "USER", label: "User" },
  { value: "JANITOR", label: "Janitor" },
  { value: "TASK_COORDINATOR", label: "Task Coordinator" },
  { value: "SYSTEM", label: "System" },
] as const;

const STATUSES = [
  { value: "running", label: "Running" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ERROR", label: "Error" },
  { value: "HALTED", label: "Halted" },
  { value: "FAILED", label: "Failed" },
] as const;

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
] as const;

const POD_OPTIONS = [
  { value: "true", label: "Has Pod" },
  { value: "false", label: "No Pod" },
] as const;

export function TaskFilters({
  filters,
  onFiltersChange,
  onClearFilters,
}: TaskFiltersProps) {
  const [open, setOpen] = useState(false);

  const hasActiveFilters = Object.keys(filters).length > 0;

  const handleSourceTypeChange = (value: string) => {
    const newFilters = { ...filters };
    if (newFilters.sourceType === value) {
      delete newFilters.sourceType;
    } else {
      newFilters.sourceType = value;
    }
    onFiltersChange(newFilters);
  };

  const handleStatusChange = (value: string) => {
    const newFilters = { ...filters };
    if (newFilters.status === value) {
      delete newFilters.status;
    } else {
      newFilters.status = value;
    }
    onFiltersChange(newFilters);
  };

  const handlePriorityChange = (value: string) => {
    const newFilters = { ...filters };
    if (newFilters.priority === value) {
      delete newFilters.priority;
    } else {
      newFilters.priority = value;
    }
    onFiltersChange(newFilters);
  };

  const handleHasPodChange = (value: string) => {
    const newFilters = { ...filters };
    const boolValue = value === "true";
    if (newFilters.hasPod === boolValue) {
      delete newFilters.hasPod;
    } else {
      newFilters.hasPod = boolValue;
    }
    onFiltersChange(newFilters);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            data-testid="task-filters-button"
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                {Object.keys(filters).length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start" data-testid="task-filters-popover">
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Source Type</h4>
              <div className="space-y-2">
                {SOURCE_TYPES.map((type) => (
                  <div key={type.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`source-${type.value}`}
                      checked={filters.sourceType === type.value}
                      onCheckedChange={() => handleSourceTypeChange(type.value)}
                      data-testid={`filter-sourceType-${type.value}`}
                    />
                    <Label
                      htmlFor={`source-${type.value}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {type.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="font-medium text-sm">Status</h4>
              <div className="space-y-2">
                {STATUSES.map((status) => (
                  <div key={status.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status.value}`}
                      checked={filters.status === status.value}
                      onCheckedChange={() => handleStatusChange(status.value)}
                      data-testid={`filter-status-${status.value}`}
                    />
                    <Label
                      htmlFor={`status-${status.value}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {status.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="font-medium text-sm">Priority</h4>
              <div className="space-y-2">
                {PRIORITIES.map((priority) => (
                  <div key={priority.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`priority-${priority.value}`}
                      checked={filters.priority === priority.value}
                      onCheckedChange={() => handlePriorityChange(priority.value)}
                      data-testid={`filter-priority-${priority.value}`}
                    />
                    <Label
                      htmlFor={`priority-${priority.value}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {priority.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="font-medium text-sm">Pod Status</h4>
              <div className="space-y-2">
                {POD_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`pod-${option.value}`}
                      checked={
                        filters.hasPod !== undefined &&
                        filters.hasPod === (option.value === "true")
                      }
                      onCheckedChange={() => handleHasPodChange(option.value)}
                      data-testid={`filter-hasPod-${option.value}`}
                    />
                    <Label
                      htmlFor={`pod-${option.value}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

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
