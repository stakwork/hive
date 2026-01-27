"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Bell, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { FeatureListResponse } from "@/types/roadmap";
import { FEATURE_STATUS_LABELS } from "@/types/roadmap";

export function NeedsInputDropdownWidget() {
  const { workspace, slug } = useWorkspace();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery<FeatureListResponse>({
    queryKey: ["needs-input-dropdown", workspace?.id],
    queryFn: async () => {
      const response = await fetch(
        `/api/features?workspaceId=${workspace?.id}&needsAttention=true&limit=6`
      );
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled: !!workspace?.id,
    staleTime: 5 * 60 * 1000,
  });

  const count = data?.pagination?.totalCount ?? 0;
  const features = data?.data ?? [];
  const displayedFeatures = features.slice(0, 5);
  const hasMore = count > 5;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Hide when error or no items need attention
  if (isError || count === 0) {
    return null;
  }

  const displayCount = count > 9 ? "9+" : count.toString();

  const handleFeatureClick = (featureId: string) => {
    router.push(`/w/${slug}/plan/${featureId}`);
  };

  const handleViewAll = () => {
    router.push(`/w/${slug}/plan?needsAttention=true`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-pointer">
          <Bell className="w-5 h-5 text-amber-500" />
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-xs flex items-center justify-center font-medium px-1">
            {displayCount}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-72 bg-card border-border">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Features awaiting feedback
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {displayedFeatures.map((feature) => (
          <DropdownMenuItem
            key={feature.id}
            onClick={() => handleFeatureClick(feature.id)}
            className="flex flex-col items-start gap-0.5 cursor-pointer"
          >
            <span className="font-medium truncate w-full">{feature.title}</span>
            <span className="text-xs text-muted-foreground">
              {FEATURE_STATUS_LABELS[feature.status]}
            </span>
          </DropdownMenuItem>
        ))}
        {hasMore && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleViewAll}
              className="text-center justify-center text-sm text-amber-600 hover:text-amber-700 cursor-pointer"
            >
              View all {count} items
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
