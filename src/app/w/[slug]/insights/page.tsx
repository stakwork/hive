"use client";

import { useState } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { redirect } from "next/navigation";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { PageHeader } from "@/components/ui/page-header";
import { RecommendationsSection } from "@/components/insights/RecommendationsSection";
import { JanitorSection, JanitorItem } from "@/components/insights/JanitorSection";
import { BarChart3, TestTube, Wrench, Shield, FlaskConical, Zap, Type, BookOpen, Package, GitPullRequest } from "lucide-react";

// Testing janitors - real data
const testingJanitors: JanitorItem[] = [
  { 
    id: "UNIT_TESTS", 
    name: "Unit Tests", 
    icon: FlaskConical, 
    description: "Identify missing unit tests.",
    configKey: "unitTestsEnabled"
  },
  { 
    id: "INTEGRATION_TESTS", 
    name: "Integration Tests", 
    icon: Zap, 
    description: "Identify missing integration tests.",
    configKey: "integrationTestsEnabled"
  },
];

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
  
  // State for hardcoded janitors
  const [hardcodedStates] = useState<Record<string, boolean>>({
    refactoring: false,
    semantic: false,
    documentation: false,
    security: false,
    'supply-chain': false,
    'pr-reviews': false
  });
  
  // Trigger for refreshing recommendations
  const [recommendationsRefreshTrigger, setRecommendationsRefreshTrigger] = useState(0);

  if (!canAccessInsights) {
    redirect("/");
  }

  // Callback for refreshing recommendations from child components
  const handleRecommendationsUpdate = () => {
    // Increment trigger to force RecommendationsSection to re-fetch data
    setRecommendationsRefreshTrigger(prev => prev + 1);
  };



  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <PageHeader
        title="Insights"
        description="Automated codebase analysis and recommendations"
        icon={BarChart3}
      />

      <TestCoverageCard />

      <RecommendationsSection refreshTrigger={recommendationsRefreshTrigger} />

      <JanitorSection
        title="Testing"
        description="Automated testing recommendations and coverage analysis"
        icon={<TestTube className="h-5 w-5 text-blue-500" />}
        janitors={testingJanitors}
        onRecommendationsUpdate={handleRecommendationsUpdate}
      />

      <JanitorSection
        title="Maintainability"
        description="Code quality and maintainability improvements (Coming soon)"
        icon={<Wrench className="h-5 w-5 text-orange-500" />}
        janitors={maintainabilityJanitors}
        hardcodedStates={hardcodedStates}
        comingSoon={true}
      />

      <JanitorSection
        title="Security"
        description="Security scanning and vulnerability detection (Coming soon)"
        icon={<Shield className="h-5 w-5 text-red-500" />}
        janitors={securityJanitors}
        hardcodedStates={hardcodedStates}
        comingSoon={true}
      />
    </div>
  );
}