"use client";

import React, { useState, useCallback } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface FilterState {
  isRunning: boolean;
  hasPodAttached: boolean;
}

export interface FilterButtonProps {
  onFilterChange?: (filters: FilterState) => void;
  initialFilters?: FilterState;
}

export function FilterButton({ onFilterChange, initialFilters }: FilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(initialFilters?.isRunning ?? false);
  const [hasPodAttached, setHasPodAttached] = useState(initialFilters?.hasPodAttached ?? false);

  const activeFilterCount = [isRunning, hasPodAttached].filter(Boolean).length;

  const handleRunningChange = useCallback((checked: boolean) => {
    setIsRunning(checked);
    onFilterChange?.({ isRunning: checked, hasPodAttached });
  }, [hasPodAttached, onFilterChange]);

  const handlePodAttachedChange = useCallback((checked: boolean) => {
    setHasPodAttached(checked);
    onFilterChange?.({ isRunning, hasPodAttached: checked });
  }, [isRunning, onFilterChange]);

  const handleClearFilters = useCallback(() => {
    setIsRunning(false);
    setHasPodAttached(false);
    onFilterChange?.({ isRunning: false, hasPodAttached: false });
  }, [onFilterChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Filter tasks"
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 rounded-full px-1.5 py-0.5 text-xs"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-4" align="start">
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="filter-running"
                checked={isRunning}
                onChange={(e) => handleRunningChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
              />
              <label
                htmlFor="filter-running"
                className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Running tasks
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="filter-pod-attached"
                checked={hasPodAttached}
                onChange={(e) => handlePodAttachedChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
              />
              <label
                htmlFor="filter-pod-attached"
                className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Has pod attached
              </label>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="border-t pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="w-full justify-center"
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
