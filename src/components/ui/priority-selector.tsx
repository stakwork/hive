"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FeaturePriority } from "@/types/roadmap";

const priorityConfig: Record<FeaturePriority, { label: string; color: string; dotColor: string }> = {
  NONE: {
    label: "None",
    color: "bg-gray-100 text-gray-700 border-gray-300",
    dotColor: "bg-gray-400",
  },
  LOW: {
    label: "Low",
    color: "bg-blue-50 text-blue-700 border-blue-300",
    dotColor: "bg-blue-500",
  },
  MEDIUM: {
    label: "Medium",
    color: "bg-yellow-50 text-yellow-700 border-yellow-300",
    dotColor: "bg-yellow-500",
  },
  HIGH: {
    label: "High",
    color: "bg-orange-50 text-orange-700 border-orange-300",
    dotColor: "bg-orange-500",
  },
  URGENT: {
    label: "Urgent",
    color: "bg-red-50 text-red-700 border-red-300",
    dotColor: "bg-red-500",
  },
};

interface PrioritySelectorProps {
  value: FeaturePriority;
  onChange: (priority: FeaturePriority) => void;
  disabled?: boolean;
  className?: string;
}

export function PrioritySelector({
  value,
  onChange,
  disabled = false,
  className,
}: PrioritySelectorProps) {
  const [open, setOpen] = React.useState(false);

  const selectedConfig = priorityConfig[value];

  // Hide the selector completely when priority is NONE (for table view)
  if (value === "NONE") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-[180px] justify-center text-muted-foreground hover:text-foreground",
              className
            )}
          >
            <span className="text-sm">-</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[180px] p-0">
          <Command>
            <CommandInput placeholder="Search priority..." />
            <CommandList>
              <CommandEmpty>No priority found.</CommandEmpty>
              <CommandGroup>
                {Object.entries(priorityConfig).map(([priority, config]) => (
                  <CommandItem
                    key={priority}
                    value={priority}
                    onSelect={() => {
                      onChange(priority as FeaturePriority);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === priority ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <div className={cn("h-2 w-2 rounded-full", config.dotColor)} />
                      <span>{config.label}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-[180px] justify-between",
            selectedConfig.color,
            "border",
            className
          )}
        >
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", selectedConfig.dotColor)} />
            <span className="font-medium">{selectedConfig.label}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-0">
        <Command>
          <CommandInput placeholder="Search priority..." />
          <CommandList>
            <CommandEmpty>No priority found.</CommandEmpty>
            <CommandGroup>
              {Object.entries(priorityConfig).map(([priority, config]) => (
                <CommandItem
                  key={priority}
                  value={priority}
                  onSelect={() => {
                    onChange(priority as FeaturePriority);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === priority ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", config.dotColor)} />
                    <span>{config.label}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface PriorityBadgeProps {
  priority: FeaturePriority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  // Don't render anything when priority is NONE
  if (priority === "NONE") {
    return null;
  }

  const config = priorityConfig[priority];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold",
        config.color,
        className
      )}
    >
      <div className={cn("h-1.5 w-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </div>
  );
}
