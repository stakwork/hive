"use client";

import { useState } from "react";
import { FeaturePriority } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURE_PRIORITY_LABELS, FEATURE_PRIORITY_COLORS } from "@/types/roadmap";

interface PriorityPopoverProps {
  featureId: string;
  currentPriority: FeaturePriority;
  onPriorityChange?: (priority: FeaturePriority) => void;
  disabled?: boolean;
}

export function PriorityPopover({
  featureId,
  currentPriority,
  onPriorityChange,
  disabled = false,
}: PriorityPopoverProps) {
  const [open, setOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handlePriorityChange = async (newPriority: FeaturePriority) => {
    if (newPriority === currentPriority || disabled) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/features/${featureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });

      if (!response.ok) {
        throw new Error("Failed to update priority");
      }

      onPriorityChange?.(newPriority);
      setOpen(false);
    } catch (error) {
      console.error("Error updating priority:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const priorities: FeaturePriority[] = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 justify-between gap-2 px-2 font-normal border",
            FEATURE_PRIORITY_COLORS[currentPriority],
            disabled && "opacity-50 cursor-not-allowed"
          )}
          disabled={disabled || isUpdating}
        >
          <span className="text-xs">
            {FEATURE_PRIORITY_LABELS[currentPriority]}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        <div className="space-y-1">
          {priorities.map((priority) => (
            <button
              key={priority}
              onClick={() => handlePriorityChange(priority)}
              className={cn(
                "w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors flex items-center justify-between",
                priority === currentPriority && "bg-accent"
              )}
              disabled={isUpdating}
            >
              <span className={cn(
                "inline-flex items-center gap-2 px-2 py-0.5 rounded-sm border text-xs",
                FEATURE_PRIORITY_COLORS[priority]
              )}>
                {FEATURE_PRIORITY_LABELS[priority]}
              </span>
              {priority === currentPriority && (
                <Check className="h-4 w-4" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
