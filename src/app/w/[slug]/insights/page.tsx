"use client";

import { JanitorItem, JanitorSection } from "@/components/insights/JanitorSection";
import { RecommendationsSection } from "@/components/insights/RecommendationsSection";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/use-toast";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { RecommendationsUpdatedEvent, usePusherConnection } from "@/hooks/usePusherConnection";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getAllJanitorItems } from "@/lib/constants/janitor";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { BookOpen, GitPullRequest, Package, Shield, TestTube, Type, Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { useCallback, useEffect } from "react";

// Get all janitor items and separate them by category
const allJanitors = getAllJanitorItems();
const testingJanitors: JanitorItem[] = [
  ...allJanitors.filter(j => j.id !== "SECURITY_REVIEW"),
  { id: "pr-reviews", name: "PR Reviews", icon: GitPullRequest, description: "Enable automatic PR reviews.", comingSoon: true },
];
const securityReviewJanitor = allJanitors.find(j => j.id === "SECURITY_REVIEW");

// Maintainability janitors - coming soon
const maintainabilityJanitors: JanitorItem[] = [
  { id: "refactoring", name: "Refactoring", icon: Wrench, description: "Identify refactoring opportunities." },
  { id: "semantic", name: "Semantic Renaming", icon: Type, description: "Suggest better variable names." },
  { id: "documentation", name: "Documentation", icon: BookOpen, description: "Generate missing documentation." },
];

// Security janitors
const securityJanitors: JanitorItem[] = [
  ...(securityReviewJanitor ? [securityReviewJanitor] : []),
  { id: "supply-chain", name: "Supply Chain", icon: Package, description: "Check dependencies risk.", comingSoon: true },
];

export default function InsightsPage() {
  const canAccessInsights = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { fetchRecommendations, fetchJanitorConfig, reset } = useInsightsStore();
  const { toast } = useToast();

  if (!canAccessInsights) {
    redirect("/");
  }

  // Handle recommendations updated events
  const handleRecommendationsUpdated = useCallback((update: RecommendationsUpdatedEvent) => {
    if (workspace?.slug && update.workspaceSlug === workspace.slug) {
      // Show toast notification for new recommendations
      toast({
        title: "New recommendations available",
        description: `${update.newRecommendationCount} new recommendations found`,
        duration: 5000,
      });

      // Simply refetch recommendations to get the latest data
      fetchRecommendations(workspace.slug);
    }
  }, [workspace?.slug, toast, fetchRecommendations]);

  // Set up workspace Pusher connection
  const { isConnected, error: pusherError } = usePusherConnection({
    workspaceSlug: workspace?.slug || null,
    onRecommendationsUpdated: handleRecommendationsUpdated,
  });

  // Show Pusher connection errors as toasts
  useEffect(() => {
    if (pusherError) {
      toast({
        title: "Real-time updates unavailable",
        description: pusherError,
        variant: "destructive",
      });
    }
  }, [pusherError, toast]);

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
      <PageHeader
        title="Insights"
        description="Automated codebase analysis and recommendations"
      />

      <div className="max-w-4xl space-y-6">{/* Content container */}

        <TestCoverageCard />

        <RecommendationsSection />

        <JanitorSection
          title="Testing"
          description="Automated testing recommendations and coverage analysis"
          icon={<TestTube className="h-5 w-5 text-blue-500" />}
          janitors={testingJanitors}
        />

        <JanitorSection
          title="Maintainability"
          description="Code quality and maintainability improvements"
          icon={<Wrench className="h-5 w-5 text-orange-500" />}
          janitors={maintainabilityJanitors}
          comingSoon={true}
        />

        <JanitorSection
          title="Security"
          description="Security scanning and vulnerability detection"
          icon={<Shield className="h-5 w-5 text-red-500" />}
          janitors={securityJanitors}
        />
      </div>{/* End content container */}
    </div>
  );
}