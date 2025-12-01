"use client";

import { JanitorItem, JanitorSection } from "@/components/insights/JanitorSection";
import { PageHeader } from "@/components/ui/page-header";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getAllJanitorItems } from "@/lib/constants/janitor";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useInsightsStore } from "@/stores/useInsightsStore";
import { BookOpen, Bot, CheckCircle2, GitPullRequest, ListTodo, Package, Shield, TestTube, Type, Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { useEffect } from "react";

// Get all janitor items and separate them by category
const allJanitors = getAllJanitorItems();
const testingJanitors: JanitorItem[] = [
  ...allJanitors.filter((j) => j.id !== "SECURITY_REVIEW"),
  {
    id: "pr-reviews",
    name: "PR Reviews",
    icon: GitPullRequest,
    description: "Enable automatic PR reviews.",
    comingSoon: true,
  },
];
const securityReviewJanitor = allJanitors.find((j) => j.id === "SECURITY_REVIEW");

// Maintainability janitors - coming soon
const maintainabilityJanitors: JanitorItem[] = [
  { id: "refactoring", name: "Refactoring", icon: Wrench, description: "Identify refactoring opportunities." },
  { id: "semantic", name: "Semantic Renaming", icon: Type, description: "Suggest better variable names." },
  { id: "documentation", name: "Documentation", icon: BookOpen, description: "Generate missing documentation." },
];

// Security janitors
const securityJanitors: JanitorItem[] = [
  ...(securityReviewJanitor ? [securityReviewJanitor] : []),
  {
    id: "supply-chain",
    name: "Supply Chain",
    icon: Package,
    description: "Check dependencies risk.",
    comingSoon: true,
  },
];

// Task Coordinator janitors
const taskCoordinatorJanitors: JanitorItem[] = [
  {
    id: "ticket-sweep",
    name: "Ticket Sweep",
    icon: ListTodo,
    description: "Automatically process tasks assigned to the Task Coordinator",
    configKey: "ticketSweepEnabled",
  },
  {
    id: "recommendation-sweep",
    name: "Recommendation Sweep",
    icon: CheckCircle2,
    description: "Automatically accept janitor recommendations",
    configKey: "recommendationSweepEnabled",
  },
];

export default function DefenseJanitorsPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const {
    fetchJanitorConfig,
    reset
  } = useInsightsStore();

  if (!canAccessDefense) {
    redirect("/");
  }

  // Initialize store data on mount
  useEffect(() => {
    if (workspace?.slug) {
      fetchJanitorConfig(workspace.slug);
    }

    // Reset store when component unmounts or workspace changes
    return () => {
      reset();
    };
  }, [workspace?.slug, fetchJanitorConfig, reset]);

  return (
    <div className="space-y-6">
      <PageHeader title="Janitors" />

      <div className="max-w-5xl space-y-6">
        <JanitorSection
          title="Task Coordinator"
          description="Automate task creation from recommendations and tickets"
          icon={<Bot className="h-5 w-5 text-blue-500" />}
          janitors={taskCoordinatorJanitors}
        />

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
      </div>
    </div>
  );
}
