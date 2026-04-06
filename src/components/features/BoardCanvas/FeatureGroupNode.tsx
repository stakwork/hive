"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { FEATURE_STATUS_LABELS, FEATURE_STATUS_COLORS } from "@/types/roadmap";
import type { FeatureStatus } from "@/types/roadmap";

export interface FeatureGroupNodeData extends Record<string, unknown> {
  featureId: string;
  title: string;
  status: FeatureStatus;
  taskCount: number;
  slug: string;
}

interface FeatureGroupNodeProps {
  data: FeatureGroupNodeData;
}

export function FeatureGroupNode({ data }: FeatureGroupNodeProps) {
  const router = useRouter();
  const { featureId, title, status, taskCount, slug } = data;

  const handleHeaderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/w/${slug}/plan/${featureId}`);
  };

  const statusColorClass =
    FEATURE_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div
      className="h-full w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 shadow-md overflow-hidden"
      data-testid="feature-group-node"
      data-feature-id={featureId}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
        onClick={handleHeaderClick}
        data-testid="feature-group-header"
        style={{ height: 48 }}
      >
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
          {title}
        </span>
        <Badge
          variant="outline"
          className={`text-xs shrink-0 border ${statusColorClass}`}
          data-testid="feature-status-badge"
        >
          {FEATURE_STATUS_LABELS[status]}
        </Badge>
      </div>

      {/* Empty task hint */}
      {taskCount === 0 && (
        <div className="flex items-center justify-center h-[60px] text-xs text-gray-400 dark:text-gray-600 italic">
          No tasks
        </div>
      )}
    </div>
  );
}
