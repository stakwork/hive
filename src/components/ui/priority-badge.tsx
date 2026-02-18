"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowUp, Minus, ArrowDown } from "lucide-react";
import type { Priority } from "@prisma/client";

interface PriorityConfig {
  icon: React.ReactNode;
  label: string;
  className: string;
}

const PRIORITY_CONFIG: Record<Priority, PriorityConfig> = {
  LOW: {
    icon: <ArrowDown className="h-3 w-3" />,
    label: "Low",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  MEDIUM: {
    icon: <Minus className="h-3 w-3" />,
    label: "Medium",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  HIGH: {
    icon: <ArrowUp className="h-3 w-3" />,
    label: "High",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  CRITICAL: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Critical",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  if (!config) {
    return null;
  }

  return (
    <Badge className={`${config.className} ${className || ""}`}>
      <span className="flex items-center gap-1.5">
        {config.icon}
        {config.label}
      </span>
    </Badge>
  );
}

export function getPriorityConfig(priority: string): PriorityConfig | null {
  return PRIORITY_CONFIG[priority as Priority] || null;
}

export function getAllPriorityOptions(): Priority[] {
  return Object.keys(PRIORITY_CONFIG) as Priority[];
}
