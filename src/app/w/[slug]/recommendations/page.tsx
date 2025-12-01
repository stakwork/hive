"use client";

import { RecommendationsSection } from "@/components/insights/RecommendationsSection";
import { GitLeaksSection } from "@/components/insights/GitLeaksSection";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { RecommendationsUpdatedEvent, usePusherConnection } from "@/hooks/usePusherConnection";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { redirect } from "next/navigation";
import { useCallback, useEffect } from "react";

export default function DefenseInsightsPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const {
    fetchRecommendations,
    fetchJanitorConfig,
    reset
  } = useInsightsStore();
  if (!canAccessDefense) {
    redirect("/");
  }

  // Handle recommendations updated events
  const handleRecommendationsUpdated = useCallback(
    (update: RecommendationsUpdatedEvent) => {
      if (workspace?.slug && update.workspaceSlug === workspace.slug) {
        // Show toast notification for new recommendations
        toast("New recommendations available", {
          description: `${update.newRecommendationCount} new recommendations found`,
          duration: 5000,
        });

        // Simply refetch recommendations to get the latest data
        fetchRecommendations(workspace.slug);
      }
    },
    [workspace?.slug, toast, fetchRecommendations],
  );

  // Set up workspace Pusher connection
  const { error: pusherError } = usePusherConnection({
    workspaceSlug: workspace?.slug || null,
    onRecommendationsUpdated: handleRecommendationsUpdated,
  });

  // Show Pusher connection errors as toasts
  useEffect(() => {
    if (pusherError) {
      toast.error("Real-time updates unavailable", { description: pusherError });
    }
  }, [pusherError]);

  // Initialize store data on mount
  useEffect(() => {
    if (workspace?.slug) {
      fetchRecommendations(workspace.slug);
      fetchJanitorConfig(workspace.slug);
    }

    // Reset store when component unmounts or workspace changes
    return () => {
      reset();
    };
  }, [workspace?.slug, fetchRecommendations, fetchJanitorConfig, reset]);

  return (
    <div className="space-y-6">
      <PageHeader title="Recommendations" />

      <div className="max-w-5xl space-y-6">
        <RecommendationsSection />

        <GitLeaksSection />
      </div>
    </div>
  );
}
