"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriorityBadge, getAllPriorityOptions } from "@/components/ui/priority-badge";
import type { Priority } from "@prisma/client";

interface PriorityPopoverProps {
  currentPriority: Priority;
  onUpdate: (priority: Priority) => Promise<void>;
}

export function PriorityPopover({ currentPriority, onUpdate }: PriorityPopoverProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const priorityOptions = getAllPriorityOptions();

  const handleSelect = async (priority: Priority) => {
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
              <PriorityBadge priority={priority} />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
