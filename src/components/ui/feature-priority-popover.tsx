"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriorityBadge } from "@/components/ui/priority-selector";
import type { FeaturePriority } from "@/types/roadmap";

// Get all feature priority options
const getAllFeaturePriorityOptions = (): FeaturePriority[] => {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
};

interface FeaturePriorityPopoverProps {
  currentPriority: FeaturePriority;
  onUpdate: (priority: FeaturePriority) => Promise<void>;
}

export function FeaturePriorityPopover({
  currentPriority,
  onUpdate
}: FeaturePriorityPopoverProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const priorityOptions = getAllFeaturePriorityOptions();

  const handleSelect = async (priority: FeaturePriority) => {
    if (priority === currentPriority || updating) {
      setOpen(false);
      return;
    }

    try {
      setUpdating(true);
      await onUpdate(priority);
      setOpen(false);
    } catch (error) {
      console.error("Failed to update priority:", error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <PriorityBadge priority={currentPriority} />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          {priorityOptions.map((priority) => (
            <div
              key={priority}
              className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-muted transition-colors ${
                currentPriority === priority ? "bg-muted" : ""
              } ${updating ? "opacity-50 pointer-events-none" : ""}`}
              onClick={() => handleSelect(priority)}
            >
              <PriorityBadge priority={priority} showLowPriority={true} />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
