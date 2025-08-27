"use client";

import { JanitorItem, JanitorSection } from "@/components/insights/JanitorSection";
import { RecommendationsSection } from "@/components/insights/RecommendationsSection";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getAllJanitorItems } from "@/lib/constants/janitor";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { BarChart3, BookOpen, GitPullRequest, Package, Shield, TestTube, Type, Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { useEffect } from "react";

// Testing janitors - real data from centralized constants
const testingJanitors: JanitorItem[] = getAllJanitorItems();

// Maintainability janitors - coming soon
const maintainabilityJanitors: JanitorItem[] = [
  { id: "refactoring", name: "Refactoring", icon: Wrench, description: "Identify refactoring opportunities." },
  { id: "semantic", name: "Semantic Renaming", icon: Type, description: "Suggest better variable names." },
  { id: "documentation", name: "Documentation", icon: BookOpen, description: "Generate missing documentation." },
];

// Security janitors - coming soon  
const securityJanitors: JanitorItem[] = [
  { id: "security", name: "Security Scan", icon: Shield, description: "Scan for vulnerabilities." },
  { id: "supply-chain", name: "Supply Chain", icon: Package, description: "Check dependencies risk." },
  { id: "pr-reviews", name: "PR Reviews", icon: GitPullRequest, description: "Enable automatic PR reviews." },
];

export default function InsightsPage() {
  const canAccessInsights = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const { fetchRecommendations, fetchJanitorConfig, reset } = useInsightsStore();

  if (!canAccessInsights) {
    redirect("/");
  }

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
        description="Code quality and maintainability improvements (Coming soon)"
        icon={<Wrench className="h-5 w-5 text-orange-500" />}
        janitors={maintainabilityJanitors}
        comingSoon={true}
      />

      <JanitorSection
        title="Security"
        description="Security scanning and vulnerability detection (Coming soon)"
        icon={<Shield className="h-5 w-5 text-red-500" />}
        janitors={securityJanitors}
        comingSoon={true}
      />
      </div>{/* End content container */}
    </div>
  );
}