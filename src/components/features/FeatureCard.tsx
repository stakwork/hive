"use client";

import { Calendar, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import type { FeatureWithDetails } from "@/types/roadmap";
import { FEATURE_STATUS_LABELS, FEATURE_STATUS_COLORS, FEATURE_PRIORITY_LABELS, FEATURE_PRIORITY_COLORS } from "@/types/roadmap";
import { cn } from "@/lib/utils";

interface FeatureCardProps {
  feature: FeatureWithDetails;
  workspaceSlug: string;
  hideStatus?: boolean;
}

export function FeatureCard({ feature, workspaceSlug, hideStatus = false }: FeatureCardProps) {
  const router = useRouter();

  const handleClick = () => {
    router.push(`/w/${workspaceSlug}/plan/${feature.id}`);
  };

  return (
    <div
      data-testid="feature-card"
      data-feature-id={feature.id}
      className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
      onClick={handleClick}
    >
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h4 className="text-sm font-medium line-clamp-1 min-w-0">{feature.title}</h4>
        </div>
        {!hideStatus && (
          <Badge className={`${FEATURE_STATUS_COLORS[feature.status]} flex-shrink-0`}>
            {FEATURE_STATUS_LABELS[feature.status]}
          </Badge>
        )}
      </div>

      {feature.priority !== "NONE" && (
        <div className="mb-2">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border",
              FEATURE_PRIORITY_COLORS[feature.priority]
            )}
          >
            {FEATURE_PRIORITY_LABELS[feature.priority]}
          </span>
        </div>
      )}

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
          <span>{formatRelativeTime(feature.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
