"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Inbox, Calendar, Loader2, CheckCircle, XCircle } from "lucide-react";
import { FeatureStatus } from "@prisma/client";

interface StatusPopoverProps {
  currentStatus: FeatureStatus;
  onUpdate: (status: FeatureStatus) => Promise<void>;
  statusColors: Record<string, string>;
}

const STATUS_OPTIONS = Object.values(FeatureStatus);

const STATUS_ICONS: Record<FeatureStatus, React.ReactNode> = {
  BACKLOG: <Inbox className="h-3 w-3 text-gray-500" />,
  PLANNED: <Calendar className="h-3 w-3 text-purple-600" />,
  IN_PROGRESS: <Loader2 className="h-3 w-3 text-amber-600" />,
  COMPLETED: <CheckCircle className="h-3 w-3 text-green-600" />,
  CANCELLED: <XCircle className="h-3 w-3 text-red-600" />,
};

export function StatusPopover({ currentStatus, onUpdate, statusColors }: StatusPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (status: FeatureStatus) => {
    if (status === currentStatus) {
      setOpen(false);
      return;
    }

    try {
      await onUpdate(status);
      setOpen(false);
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <Badge className={statusColors[currentStatus]}>
            <span className="flex items-center gap-1.5">
              {STATUS_ICONS[currentStatus]}
              {currentStatus.replace("_", " ")}
            </span>
          </Badge>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          {STATUS_OPTIONS.map((s) => (
            <div
              key={s}
              className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-muted ${
                currentStatus === s ? "bg-muted" : ""
              }`}
              onClick={() => handleSelect(s)}
            >
              <Badge className={statusColors[s]}>
                <span className="flex items-center gap-1.5">
                  {STATUS_ICONS[s]}
                  {s.replace("_", " ")}
                </span>
              </Badge>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
