"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge, getAllStatusOptions, getStatusConfig } from "@/components/ui/status-badge";
import type { FeatureStatus, PhaseStatus, TaskStatus } from "@prisma/client";

type StatusType = "feature" | "phase" | "task";

interface StatusPopoverProps<T extends FeatureStatus | PhaseStatus | TaskStatus> {
  statusType: StatusType;
  currentStatus: T;
  onUpdate: (status: T) => Promise<void>;
}

export function StatusPopover<T extends FeatureStatus | PhaseStatus | TaskStatus>({
  statusType,
  currentStatus,
  onUpdate,
}: StatusPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const statusOptions = getAllStatusOptions(statusType);

  const handleSelect = async (status: T) => {
    if (status === currentStatus || updating) {
      setOpen(false);
      return;
    }

    try {
      setUpdating(true);
      await onUpdate(status);
      setOpen(false);
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <StatusBadge statusType={statusType} status={currentStatus} />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          {statusOptions.map((status) => {
            const config = getStatusConfig(statusType, status);
            if (!config) return null;

            return (
              <div
                key={status}
                className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-muted transition-colors ${
                  currentStatus === status ? "bg-muted" : ""
                } ${updating ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => handleSelect(status as T)}
              >
                <StatusBadge statusType={statusType} status={status as T} />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
