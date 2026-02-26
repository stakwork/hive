"use client";

import { Calendar, User, Bell } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeOrDate } from "@/lib/date-utils";
import type { FeatureWithDetails } from "@/types/roadmap";
import { FEATURE_STATUS_LABELS, FEATURE_STATUS_COLORS } from "@/types/roadmap";
import { PriorityBadge } from "@/components/ui/priority-selector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeploymentStatusBadge } from "@/components/tasks/DeploymentStatusBadge";

interface FeatureCardProps {
  feature: FeatureWithDetails;
  workspaceSlug: string;
  hideStatus?: boolean;
}

export function FeatureCard({ feature, workspaceSlug, hideStatus = false }: FeatureCardProps) {
  const needsReview = feature._count.stakworkRuns > 0;

  return (
    <Link href={`/w/${workspaceSlug}/plan/${feature.id}`} className="block">
      <div
        data-testid="feature-card"
        data-feature-id={feature.id}
        className="p-3 border rounded-lg hover:bg-muted transition-colors"
      >
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h4 className="text-sm font-medium line-clamp-1 min-w-0">{feature.title}</h4>
          {needsReview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-shrink-0">
                  <Bell className="h-4 w-4 text-amber-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Awaiting your feedback</p>
              </TooltipContent>
            </Tooltip>
          )}
          {feature.deploymentStatus && (
            <DeploymentStatusBadge
              environment={feature.deploymentStatus}
              deploymentUrl={feature.deploymentUrl}
            />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PriorityBadge priority={feature.priority} />
          {!hideStatus && (
            <Badge className={FEATURE_STATUS_COLORS[feature.status]}>
              {FEATURE_STATUS_LABELS[feature.status]}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {feature.assignee && (
          <div className="flex items-center gap-2">
            <Avatar className="size-5">
              <AvatarImage src={feature.assignee.image || undefined} />
              <AvatarFallback className="text-xs">
                <User className="w-3 h-3" />
              </AvatarFallback>
            </Avatar>
            <span>{feature.assignee.name || feature.assignee.email}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{formatRelativeOrDate(feature.createdAt)}</span>
        </div>
      </div>
      </div>
    </Link>
  );
}
