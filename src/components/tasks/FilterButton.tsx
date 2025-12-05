"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter } from "lucide-react";

export type TaskFilter = {
  workflowStatus?: string[];
  sourceType?: string[];
  mode?: string[];
};

interface FilterButtonProps {
  filters: TaskFilter;
  onFilterChange: (filters: TaskFilter) => void;
}

export function FilterButton({ filters, onFilterChange }: FilterButtonProps) {
  const workflowStatusOptions = [
    { value: "PENDING", label: "Open" },
    { value: "IN_PROGRESS", label: "Running" },
    { value: "COMPLETED", label: "Completed/Merged" },
    { value: "ERROR", label: "Error" },
    { value: "HALTED", label: "Halted" },
    { value: "FAILED", label: "Failed" },
  ];

  const sourceTypeOptions = [
    { value: "JANITOR", label: "Janitor" },
    { value: "USER", label: "User" },
    { value: "TASK_COORDINATOR", label: "Task Coordinator" },
    { value: "SYSTEM", label: "System" },
  ];

  const modeOptions = [
    { value: "agent", label: "Agent" },
    { value: "live", label: "Chat" },
  ];

  const toggleFilter = (category: keyof TaskFilter, value: string) => {
    const currentValues = filters[category] || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [category]: newValues.length > 0 ? newValues : undefined,
    });
  };

  const activeFilterCount =
    (filters.workflowStatus?.length || 0) +
    (filters.sourceType?.length || 0) +
    (filters.mode?.length || 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Filter className="w-4 h-4 mr-2" />
          Filter
          {activeFilterCount > 0 && (
            <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workflow Status</DropdownMenuLabel>
        {workflowStatusOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={filters.workflowStatus?.includes(option.value) || false}
            onCheckedChange={() => toggleFilter("workflowStatus", option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Source Type</DropdownMenuLabel>
        {sourceTypeOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={filters.sourceType?.includes(option.value) || false}
            onCheckedChange={() => toggleFilter("sourceType", option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        {modeOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={filters.mode?.includes(option.value) || false}
            onCheckedChange={() => toggleFilter("mode", option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}

        {activeFilterCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={() => onFilterChange({})}
              >
                Clear All Filters
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
