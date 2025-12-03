"use client";

import * as React from "react";
import { Check, ChevronsUpDown, ArrowDown, Minus, ArrowUp, AlertCircle } from "lucide-react";

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

interface PriorityConfig {
  icon: React.ReactNode;
  label: string;
  color: string;
}

const priorityConfig: Record<FeaturePriority, PriorityConfig> = {
  LOW: {
    icon: <ArrowDown className="h-3 w-3" />,
    label: "Low",
    color: "bg-gray-100 text-gray-700 border-gray-200",
  },
  MEDIUM: {
    icon: <Minus className="h-3 w-3" />,
    label: "Medium",
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
  HIGH: {
    icon: <ArrowUp className="h-3 w-3" />,
    label: "High",
    color: "bg-orange-50 text-orange-700 border-orange-200",
  },
  CRITICAL: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Critical",
    color: "bg-red-50 text-red-700 border-red-200",
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
          <div className="flex items-center gap-1.5">
            {selectedConfig.icon}
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
                  <div className="flex items-center gap-1.5">
                    {config.icon}
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
  const config = priorityConfig[priority];

  if (!config) {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold",
        config.color,
        className
      )}
    >
      {config.icon}
      {config.label}
    </div>
  );
}
